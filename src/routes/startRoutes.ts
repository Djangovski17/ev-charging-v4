import { Router } from 'express';
import { sendRemoteStartTransaction, sendRemoteStopTransaction } from '../ocpp/ocppServer';
import { prisma } from '../services/prisma';
import { logError, logInfo } from '../services/logger';
import Stripe from 'stripe';

const router = Router();

// Inicjalizacja Stripe
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2025-11-17.clover',
});

/**
 * Obsługuje zakończenie transakcji ładowania
 * Wykonuje refund w Stripe i aktualizuje status stacji oraz transakcji
 */
const handleStopTransaction = async (stationId: string): Promise<{ success: boolean; message: string }> => {
  try {
    console.log(`[StopTransaction] Rozpoczynam obsługę zakończenia transakcji dla stacji: ${stationId}`);

    // 1. Pobierz aktywną transakcję
    console.log(`[StopTransaction] Szukam aktywnej transakcji dla stacji ${stationId}...`);
    const transaction = await prisma.transaction.findFirst({
      where: {
        stationId: stationId,
        status: {
          in: ['CHARGING', 'PENDING'],
        },
      },
      include: {
        station: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!transaction) {
      const errorMsg = `Nie znaleziono aktywnej transakcji dla stacji ${stationId}`;
      console.error(`[StopTransaction] ${errorMsg}`);
      return {
        success: false,
        message: errorMsg,
      };
    }

    console.log(`[StopTransaction] Znaleziono transakcję: ${transaction.id}, status: ${transaction.status}, energyKwh: ${transaction.energyKwh}`);

    // 2. Oblicz koszt i zwrot
    const cost = transaction.energyKwh * transaction.station.pricePerKwh;
    // amount w bazie jest w PLN (złotówkach) - patrz paymentController.ts linia 44-49
    const refundAmount = transaction.amount - cost;

    console.log(`[StopTransaction] Obliczenia: amount=${transaction.amount} PLN, energyKwh=${transaction.energyKwh}, pricePerKwh=${transaction.station.pricePerKwh} PLN/kWh`);
    console.log(`[StopTransaction] Koszt: ${cost} PLN, Kwota do zwrotu: ${refundAmount} PLN`);

    let refundId: string | null = null;

    // 3. STRIPE REFUND (Krytyczne)
    if (refundAmount > 0) {
      try {
        console.log(`[StopTransaction] Wysyłam refund do Stripe: ${refundAmount} PLN (${Math.floor(refundAmount * 100)} groszy)...`);
        
        // amount w bazie to PLN, Stripe wymaga groszy, więc mnożymy przez 100
        const refundAmountInGrosze = Math.floor(refundAmount * 100);
        
        const refund = await stripe.refunds.create({
          payment_intent: transaction.stripePaymentId,
          amount: refundAmountInGrosze,
        });

        refundId = refund.id;
        console.log(`[StopTransaction] Refund utworzony pomyślnie w Stripe: ${refundId}, status: ${refund.status}`);
      } catch (refundError) {
        // NIE PRZERYWAMY procesu zwalniania stacji nawet jeśli refund się nie powiódł
        console.error(`[StopTransaction] BŁĄD podczas tworzenia refund w Stripe:`, refundError);
        if (refundError instanceof Error) {
          console.error(`[StopTransaction] Szczegóły błędu: ${refundError.message}`);
        }
        // Kontynuujemy mimo błędu - stacja MUSI zostać zwolniona
      }
    } else {
      console.log(`[StopTransaction] Brak kwoty do zwrotu (refundAmount=${refundAmount} PLN)`);
    }

    // 4. Aktualizacja Bazy (To naprawia status "Zajęta")
    console.log(`[StopTransaction] Aktualizuję bazę danych...`);
    
    // Aktualizuj transakcję
    await prisma.transaction.update({
      where: { id: transaction.id },
      data: {
        status: 'COMPLETED',
        endTime: new Date(),
        finalCost: cost,
        refundId: refundId,
      },
    });

    console.log(`[StopTransaction] Transakcja zaktualizowana: status=COMPLETED, finalCost=${cost} PLN, refundId=${refundId || 'brak'}`);

    // Aktualizuj status stacji na AVAILABLE
    await prisma.station.update({
      where: { id: stationId },
      data: { status: 'AVAILABLE' },
    });

    console.log(`[StopTransaction] Stacja zwolniona: ${stationId} -> status=AVAILABLE`);

    return {
      success: true,
      message: `Transakcja zakończona pomyślnie. Koszt: ${cost.toFixed(2)} PLN, Zwrot: ${refundAmount > 0 ? refundAmount.toFixed(2) : '0.00'} PLN`,
    };
  } catch (error) {
    const errorMsg = `Błąd podczas obsługi zakończenia transakcji: ${error instanceof Error ? error.message : 'Nieznany błąd'}`;
    console.error(`[StopTransaction] ${errorMsg}`, error);
    logError('[StopTransaction] Critical error', error);
    
    // Próbujemy zwolnić stację nawet w przypadku błędu
    try {
      await prisma.station.update({
        where: { id: stationId },
        data: { status: 'AVAILABLE' },
      });
      console.log(`[StopTransaction] Stacja ${stationId} została zwolniona pomimo błędu`);
    } catch (stationError) {
      console.error(`[StopTransaction] Nie udało się zwolnić stacji ${stationId}:`, stationError);
    }

    return {
      success: false,
      message: errorMsg,
    };
  }
};

router.get('/start/:cpId', async (req, res) => {
  const { cpId } = req.params;
  
  const success = await sendRemoteStartTransaction(cpId);
  
  if (success) {
    res.json({
      success: true,
      message: `RemoteStartTransaction sent to ${cpId}`,
    });
  } else {
    res.status(404).json({
      success: false,
      message: `Charge point ${cpId} is not connected or no pending transaction found`,
    });
  }
});

router.get('/stop/:stationId', async (req, res) => {
  const { stationId } = req.params;
  
  console.log(`[Stop Route] Otrzymano request GET /stop/${stationId}`);
  logInfo('[Stop Route] Request received', { stationId, method: req.method, path: req.path });
  
  try {
    // Najpierw wyślij komendę RemoteStopTransaction do stacji OCPP
    const ocppSuccess = await sendRemoteStopTransaction(stationId);
    
    // Następnie wykonaj bezpośrednią obsługę zakończenia transakcji
    // (nie czekamy na odpowiedź OCPP - wykonujemy od razu)
    const result = await handleStopTransaction(stationId);
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        ocppCommandSent: ocppSuccess,
      });
    } else {
      res.status(404).json({
        success: false,
        message: result.message,
        ocppCommandSent: ocppSuccess,
      });
    }
  } catch (error) {
    logError('[Stop] Failed to stop transaction', error);
    res.status(500).json({
      success: false,
      message: 'Failed to stop transaction',
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
});

router.get('/station/:stationId', async (req, res) => {
  try {
    const { stationId } = req.params;
    
    logInfo('[Station] Fetching station status', { stationId });
    
    const station = await prisma.station.findUnique({
      where: { id: stationId },
      select: {
        id: true,
        name: true,
        status: true,
        connectorType: true,
        pricePerKwh: true,
      },
    });

    if (!station) {
      res.status(404).json({
        success: false,
        message: `Station ${stationId} not found`,
      });
      return;
    }

    res.json({
      success: true,
      station,
    });
  } catch (error) {
    logError('[Station] Failed to fetch station status', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch station status',
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
});

export default router;


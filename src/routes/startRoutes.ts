import { Router } from 'express';
import { sendRemoteStartTransaction, sendRemoteStopTransaction } from '../ocpp/ocppServer';
import { prisma } from '../services/prisma';
import { logError, logInfo } from '../services/logger';
import { sendInvoice } from '../services/emailService';
import { getIo } from '../index';
import Stripe from 'stripe';

const router = Router();

// Inicjalizacja Stripe
if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2025-11-17.clover',
});

// Mapa aktywnych symulacji energii: transactionId -> intervalId
const demoEnergySimulations = new Map<string, NodeJS.Timeout>();

/**
 * Rozpoczyna symulację energii w trybie demo
 * Zwiększa energię o ~0.01 kWh co 2 sekundy (symulacja ładowania ~18 kW)
 */
const startDemoEnergySimulation = async (chargePointId: string, transactionId: string, stationId: string): Promise<void> => {
  // Sprawdź czy już nie ma aktywnej symulacji
  if (demoEnergySimulations.has(transactionId)) {
    return;
  }

  logInfo('[Demo Energy] Starting energy simulation', { chargePointId, transactionId });

  const interval = setInterval(async () => {
    try {
      // Pobierz aktualną transakcję
      const transaction = await prisma.transaction.findUnique({
        where: { id: transactionId },
        include: { station: true },
      });

      if (!transaction || transaction.status !== 'CHARGING') {
        // Transakcja zakończona, zatrzymaj symulację
        clearInterval(interval);
        demoEnergySimulations.delete(transactionId);
        return;
      }

      // Zwiększ energię o ~0.01 kWh (symulacja ładowania ~18 kW przez 2 sekundy)
      const newEnergyKwh = transaction.energyKwh + 0.01;
      
      // Aktualizuj w bazie danych
      await prisma.transaction.update({
        where: { id: transactionId },
        data: { energyKwh: newEnergyKwh },
      });

      // Emituj przez Socket.io
      const io = getIo();
      const emitData = {
        stationId: chargePointId,
        energy: newEnergyKwh * 1000, // Konwersja na Wh
        power: 18000, // ~18 kW
      };
      
      io.emit('energy_update', emitData);
      logInfo('[Demo Energy] Updated energy', { transactionId, energyKwh: newEnergyKwh });
    } catch (error) {
      logError('[Demo Energy] Error in simulation', error);
      clearInterval(interval);
      demoEnergySimulations.delete(transactionId);
    }
  }, 2000); // Co 2 sekundy

  demoEnergySimulations.set(transactionId, interval);
};

/**
 * Zatrzymuje symulację energii dla danej transakcji
 */
const stopDemoEnergySimulation = (transactionId: string): void => {
  const interval = demoEnergySimulations.get(transactionId);
  if (interval) {
    clearInterval(interval);
    demoEnergySimulations.delete(transactionId);
    logInfo('[Demo Energy] Stopped energy simulation', { transactionId });
  }
};

/**
 * Obsługuje zakończenie transakcji ładowania
 * Wykonuje refund w Stripe i aktualizuje status stacji oraz transakcji
 */
const handleStopTransaction = async (stationId: string, customerEmail?: string): Promise<{ success: boolean; message: string; invoiceSent?: boolean; email?: string; finalCost?: number; refundAmount?: number; energyKwh?: number }> => {
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
        finalEnergy: transaction.energyKwh,
        refundId: refundId,
      } as any, // Tymczasowe obejście - pola są w schemacie Prisma
    });

    console.log(`[StopTransaction] Transakcja zaktualizowana: status=COMPLETED, finalCost=${cost} PLN, refundId=${refundId || 'brak'}`);

    // Aktualizuj status stacji na AVAILABLE
    await prisma.station.update({
      where: { id: stationId },
      data: { status: 'AVAILABLE' },
    });

    console.log(`[StopTransaction] Stacja zwolniona: ${stationId} -> status=AVAILABLE`);

    // Zatrzymaj symulację energii jeśli działa
    stopDemoEnergySimulation(transaction.id);

    // 5. Wysyłka faktury na email (jeśli email jest dostępny)
    // W wersji MVP używamy przykładowego emaila - w produkcji pobieramy z bazy użytkownika
    const emailToSend = customerEmail || 'customer@example.com'; // TODO: Pobierz z sesji/bazy użytkownika
    
    try {
      const invoiceResult = await sendInvoice({
        transactionId: transaction.id,
        email: emailToSend,
        amount: transaction.amount,
        energyKwh: transaction.energyKwh,
        cost: cost,
        refundAmount: refundAmount,
        startTime: transaction.startTime,
        endTime: new Date(),
        stationId: stationId,
        stationName: transaction.station.name,
      });
      
      if (invoiceResult.success) {
        console.log(`[StopTransaction] Faktura wysłana: ${invoiceResult.message}`);
      } else {
        console.warn(`[StopTransaction] Ostrzeżenie: ${invoiceResult.message}`);
      }
    } catch (emailError) {
      console.error(`[StopTransaction] Błąd podczas wysyłki faktury:`, emailError);
      // Nie przerywamy procesu - faktura to dodatkowa funkcjonalność
    }

    return {
      success: true,
      message: `Transakcja zakończona pomyślnie. Koszt: ${cost.toFixed(2)} PLN, Zwrot: ${refundAmount > 0 ? refundAmount.toFixed(2) : '0.00'} PLN`,
      invoiceSent: true,
      email: emailToSend,
      finalCost: cost,
      refundAmount: refundAmount,
      energyKwh: transaction.energyKwh,
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
  
  try {
    // Sprawdź czy istnieje pending transaction
    const pendingTransaction = await prisma.transaction.findFirst({
      where: {
        stationId: cpId,
        status: 'PENDING',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!pendingTransaction) {
      logError('[Start Route] No pending transaction found', { cpId });
      res.status(400).json({
        success: false,
        message: `No pending transaction found for station ${cpId}. Please complete payment first.`,
      });
      return;
    }

    // Próbuj wysłać RemoteStartTransaction
    const success = await sendRemoteStartTransaction(cpId);
    
    if (success) {
      // Aktualizuj status transakcji na CHARGING (jeśli OCPP nie zrobi tego automatycznie)
      // To zapewni, że transakcja jest widoczna jako aktywna
      await prisma.transaction.update({
        where: { id: pendingTransaction.id },
        data: { status: 'CHARGING' },
      });

      // Aktualizuj status stacji na CHARGING (Zajęta)
      await prisma.station.update({
        where: { id: cpId },
        data: { status: 'CHARGING' },
      });

      res.json({
        success: true,
        message: `RemoteStartTransaction sent to ${cpId}`,
        transactionId: pendingTransaction.id,
      });
    } else {
      // Nawet jeśli OCPP nie jest połączony, aktualizuj status na CHARGING
      // (dla symulacji/demo) i rozpocznij symulację energii
      await prisma.transaction.update({
        where: { id: pendingTransaction.id },
        data: { status: 'CHARGING' },
      });

      // Aktualizuj status stacji na CHARGING (Zajęta)
      await prisma.station.update({
        where: { id: cpId },
        data: { status: 'CHARGING' },
      });

      // Rozpocznij symulację energii w trybie demo (jeśli OCPP nie jest połączony)
      startDemoEnergySimulation(cpId, pendingTransaction.id, cpId);

      logInfo('[Start Route] Station not connected via OCPP, but transaction started in demo mode', { cpId });
      res.json({
        success: true,
        message: `Transaction started for ${cpId} (demo mode - OCPP not connected)`,
        transactionId: pendingTransaction.id,
        demoMode: true,
      });
    }
  } catch (error) {
    logError('[Start Route] Failed to start transaction', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start transaction',
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
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
    const customerEmail = req.query.email as string | undefined;
    const result = await handleStopTransaction(stationId, customerEmail);
    
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
    
    console.log(`[GET /station/:stationId] Frontend pyta o dane stacji: ${stationId}`);
    logInfo('[Station] Fetching station status', { stationId });
    
    const station = await prisma.station.findUnique({
      where: { id: stationId },
      select: {
        id: true,
        name: true,
        status: true,
        connectorType: true,
        pricePerKwh: true,
        address: true,
        city: true,
      },
    });

    if (!station) {
      console.log(`[GET /station/:stationId] Stacja nie znaleziona: ${stationId}`);
      res.status(404).json({
        success: false,
        message: `Station ${stationId} not found`,
      });
      return;
    }

    // Pobierz wszystkie aktywne transakcje dla tej stacji
    const activeTransactions = await prisma.transaction.findMany({
      where: {
        stationId: stationId,
        status: {
          in: ['CHARGING', 'ACTIVE', 'PENDING'],
        },
      },
    });

    console.log(`[GET /station/:stationId] Znaleziono ${activeTransactions.length} aktywnych transakcji dla stacji ${stationId}`);

    // Definiuj listę złączy (zgodnie z frontendem: 3 złącza)
    // W rzeczywistości złącza powinny być w bazie danych, ale na razie używamy hardcoded listy
    const connectors = [
      { id: '1', name: 'Złącze A', type: 'Type 2', power: '22 kW', defaultStatus: 'AVAILABLE' },
      { id: '2', name: 'Złącze B', type: 'CCS', power: '50 kW', defaultStatus: 'AVAILABLE' },
      { id: '3', name: 'Złącze C', type: 'CHAdeMO', power: '50 kW', defaultStatus: 'AVAILABLE' },
    ];

    // Sprawdź dla każdego złącza, czy istnieje aktywna transakcja
    // Ponieważ Transaction nie ma connectorId, sprawdzamy czy istnieje aktywna transakcja dla stacji
    // Zgodnie z logiką OCPP, connectorId: 1 jest domyślnie używany
    const connectorsWithStatus = connectors.map(connector => {
      // Jeśli istnieje aktywna transakcja, złącze 1 jest zajęte (zgodnie z logiką OCPP)
      // W przyszłości można rozszerzyć, aby Transaction miał connectorId
      const isOccupied = activeTransactions.length > 0 && connector.id === '1';
      
      return {
        id: connector.id,
        name: connector.name,
        type: connector.type,
        power: connector.power,
        status: isOccupied ? 'CHARGING' : connector.defaultStatus,
      };
    });

    console.log(`[GET /station/:stationId] Zwracam dane stacji z złączami:`, {
      id: station.id,
      name: station.name,
      address: station.address,
      city: station.city,
      pricePerKwh: station.pricePerKwh,
      connectors: connectorsWithStatus,
    });

    res.json({
      success: true,
      station: {
        ...station,
        connectors: connectorsWithStatus,
      },
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

// Endpoint do odzyskiwania aktywnej sesji ładowania
router.get('/stations/:stationId/active-session', async (req, res) => {
  try {
    const { stationId } = req.params;
    
    console.log(`[GET /stations/:stationId/active-session] Frontend pyta o aktywną sesję dla stacji: ${stationId}`);
    logInfo('[ActiveSession] Fetching active session', { stationId });
    
    // Szukaj transakcji ze statusem CHARGING lub ACTIVE (nie COMPLETED/FAULTED)
    const activeTransaction = await prisma.transaction.findFirst({
      where: {
        stationId: stationId,
        status: {
          in: ['CHARGING', 'ACTIVE', 'PENDING'],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        station: true,
      },
    });

    if (!activeTransaction) {
      console.log(`[GET /stations/:stationId/active-session] Brak aktywnej sesji dla stacji: ${stationId}`);
      res.status(404).json({
        success: false,
        message: 'No active session found',
        data: null,
      });
      return;
    }

    // Zwróć dane sesji
    const sessionData = {
      transactionId: activeTransaction.id,
      connectorId: 1, // Domyślnie 1, zgodnie z logiką OCPP
      startTime: activeTransaction.startTime,
      meterStart: 0, // Początkowa wartość licznika (0 kWh na początku)
      amount: activeTransaction.amount,
      stripePaymentId: activeTransaction.stripePaymentId,
    };

    console.log(`[GET /stations/:stationId/active-session] Znaleziono aktywną sesję:`, sessionData);
    logInfo('[ActiveSession] Active session found', { stationId, transactionId: activeTransaction.id });

    res.json({
      success: true,
      data: sessionData,
    });
  } catch (error) {
    console.error(`[GET /stations/:stationId/active-session] Błąd:`, error);
    logError('[ActiveSession] Failed to fetch active session', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active session',
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
});

// Endpoint do pobierania aktualnej energii z aktywnej transakcji
router.get('/energy/:stationId', async (req, res) => {
  try {
    const { stationId } = req.params;
    
    const activeTransaction = await prisma.transaction.findFirst({
      where: {
        stationId: stationId,
        status: 'CHARGING',
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        station: true,
      },
    });

    if (!activeTransaction) {
      res.json({
        success: true,
        energyKwh: 0,
        cost: 0,
      });
      return;
    }

    const cost = activeTransaction.energyKwh * activeTransaction.station.pricePerKwh;

    res.json({
      success: true,
      energyKwh: activeTransaction.energyKwh,
      cost: cost,
      startTime: activeTransaction.startTime,
    });
  } catch (error) {
    logError('[Energy] Failed to fetch energy', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch energy',
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
  }
});

export default router;


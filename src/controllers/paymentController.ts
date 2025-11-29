import { Request, Response } from 'express';
import { createPaymentIntent } from '../services/stripeService';
import { logError, logInfo } from '../services/logger';
import { prisma } from '../services/prisma';

export const createPaymentIntentHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { amount, stationId, connectorId } = req.body;

    if (!amount || typeof amount !== 'number') {
      res.status(400).json({
        error: 'Invalid request',
        message: 'Amount is required and must be a number',
      });
      return;
    }

    if (amount <= 0) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'Amount must be greater than 0',
      });
      return;
    }

    if (!stationId || typeof stationId !== 'string') {
      res.status(400).json({
        error: 'Invalid request',
        message: 'stationId is required and must be a string',
      });
      return;
    }

    // Walidacja connectorId jeśli jest przekazane
    if (connectorId !== undefined && connectorId !== null) {
      if (typeof connectorId !== 'string') {
        res.status(400).json({
          error: 'Invalid request',
          message: 'connectorId must be a string if provided',
        });
        return;
      }

      // Sprawdź, czy connector istnieje i należy do danej stacji
      const connector = await prisma.connector.findFirst({
        where: {
          id: connectorId,
          stationId: stationId,
        },
      });

      if (!connector) {
        console.error('[Payment] Connector not found or does not belong to station', {
          connectorId,
          stationId,
        });
        res.status(400).json({
          error: 'Invalid request',
          message: 'Connector not found or does not belong to the specified station',
        });
        return;
      }
    }

    logInfo('[Payment] Creating payment intent', { amount, stationId, connectorId });

    const result = await createPaymentIntent({ amount });

    logInfo('[Payment] Payment intent created', { id: result.id });

    // Utwórz rekord Transaction w bazie danych
    const amountInZloty = amount / 100; // Konwersja z groszy na złotówki
    
    try {
      const transactionData: {
        stripePaymentId: string;
        stationId: string;
        connectorId?: string | null;
        amount: number;
        energyKwh: number;
        startTime: Date;
        status: string;
      } = {
        stripePaymentId: result.id,
        stationId: stationId,
        amount: amountInZloty,
        energyKwh: 0,
        startTime: new Date(),
        status: 'PENDING',
      };

      // Dodaj connectorId tylko jeśli jest przekazane
      if (connectorId && typeof connectorId === 'string') {
        transactionData.connectorId = connectorId;
      }

      const transaction = await prisma.transaction.create({
        data: transactionData,
      });

      logInfo('[Payment] Transaction created in database', { 
        transactionId: transaction.id,
        stripePaymentId: result.id,
        stationId: stationId,
        connectorId: connectorId || null,
      });

      res.json({
        id: result.id,
        clientSecret: result.clientSecret,
      });
    } catch (dbError) {
      console.error('[Payment] Failed to create transaction in database', {
        error: dbError,
        stripePaymentId: result.id,
        stationId: stationId,
        connectorId: connectorId || null,
        errorMessage: dbError instanceof Error ? dbError.message : 'Unknown error',
        errorStack: dbError instanceof Error ? dbError.stack : undefined,
      });
      logError('[Payment] Database error when creating transaction', dbError);
      
      res.status(500).json({
        error: 'Database error',
        message: 'Failed to create transaction record. Payment intent was created but transaction was not saved.',
        details: dbError instanceof Error ? dbError.message : 'Unknown database error',
      });
      return;
    }
  } catch (error) {
    console.error('[Payment] Critical error in createPaymentIntentHandler', {
      error: error,
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    logError('[Payment] Failed to create payment intent', error);

    if (error instanceof Error) {
      if (error.message.includes('STRIPE_SECRET_KEY')) {
        res.status(500).json({
          error: 'Server configuration error',
          message: 'Stripe API key is not configured',
        });
        return;
      }

      res.status(500).json({
        error: 'Payment processing error',
        message: error.message,
      });
      return;
    }

    res.status(500).json({
      error: 'Payment processing error',
      message: 'An unexpected error occurred',
    });
  }
};


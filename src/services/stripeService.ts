import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: '2025-11-17.clover',
});

export interface CreatePaymentIntentParams {
  amount: number; // w groszach
}

export interface PaymentIntentResult {
  id: string;
  clientSecret: string;
}

export const createPaymentIntent = async (
  params: CreatePaymentIntentParams
): Promise<PaymentIntentResult> => {
  const { amount } = params;

  if (!amount || amount <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'pln',
    automatic_payment_methods: {
      enabled: true,
    },
  });

  if (!paymentIntent.client_secret) {
    throw new Error('Failed to create payment intent: missing client_secret');
  }

  return {
    id: paymentIntent.id,
    clientSecret: paymentIntent.client_secret,
  };
};

export interface CreateRefundParams {
  paymentIntentId: string;
  amount: number; // w groszach
}

export interface RefundResult {
  id: string;
  amount: number;
  status: string;
}

export const createRefund = async (
  params: CreateRefundParams
): Promise<RefundResult> => {
  const { paymentIntentId, amount } = params;

  if (!paymentIntentId || typeof paymentIntentId !== 'string') {
    throw new Error('PaymentIntentId is required and must be a string');
  }

  if (!amount || amount <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  const refund = await stripe.refunds.create({
    payment_intent: paymentIntentId,
    amount: amount,
  });

  return {
    id: refund.id,
    amount: refund.amount,
    status: refund.status || 'pending',
  };
};


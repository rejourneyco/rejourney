import React, { useState, useEffect } from 'react';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { config } from '../../config';
import { createSetupIntent, addPaymentMethod } from '../../services/api';
import { NeoButton } from '../ui/neo/NeoButton';
import { CreditCard, AlertTriangle, Check, X, Loader2 } from 'lucide-react';

// Initialize Stripe (lazy loaded)
let stripePromise: Promise<Stripe | null> | null = null;

function getStripe() {
  if (!stripePromise && config.stripePublishableKey) {
    // Validate that it's a publishable key (starts with pk_) not a secret key (sk_)
    if (config.stripePublishableKey.startsWith('sk_')) {
      console.error('ERROR: VITE_STRIPE_PUBLISHABLE_KEY appears to be a SECRET key (starts with sk_). It must be a PUBLISHABLE key (starts with pk_)');
      return null;
    }
    if (!config.stripePublishableKey.startsWith('pk_')) {
      console.error('ERROR: VITE_STRIPE_PUBLISHABLE_KEY does not appear to be a valid Stripe publishable key (should start with pk_)');
      return null;
    }
    stripePromise = loadStripe(config.stripePublishableKey);
  }
  return stripePromise;
}

interface PaymentFormProps {
  teamId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

// The inner form component that uses Stripe hooks
function PaymentFormInner({ teamId, onSuccess, onCancel }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();

  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [elementError, setElementError] = useState<string | null>(null);


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      setError('Stripe not loaded. Please refresh and try again.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // First, trigger form validation and collect payment details
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setError(submitError.message || 'Please check your payment details.');
        setIsProcessing(false);
        return;
      }

      // Confirm the SetupIntent - this will NOT redirect for card payments
      const { error: stripeError, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: 'if_required',
        confirmParams: {
          return_url: `${window.location.origin}${window.location.pathname}`,
        },
      });

      if (stripeError) {
        setError(stripeError.message || 'Failed to save card. Please try again.');
        setIsProcessing(false);
        return;
      }

      if (setupIntent?.payment_method) {
        // Attach the payment method to the customer
        await addPaymentMethod(teamId, setupIntent.payment_method as string);
        onSuccess();
      } else {
        setError('Failed to create payment method. Please try again.');
        setIsProcessing(false);
      }
    } catch (err) {
      console.error('Payment method error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsProcessing(false);
    }
  };

  if (!stripe || !elements) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-center">
          <Loader2 className="w-6 h-6 animate-spin text-slate-500 mx-auto mb-2" />
          <p className="text-sm font-bold text-slate-600">Initializing Stripe...</p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <div
          id="stripe-payment-element-container"
          className="min-h-[200px] border-2 border-slate-200 rounded-lg p-4 bg-white"
          style={{
            minHeight: '200px',
            width: '100%',
          }}
        >
          <PaymentElement
            onReady={() => {
              setIsReady(true);
              setElementError(null);
            }}
            onChange={(e) => {
              if (e.complete) {
                setError(null);
                setElementError(null);
              }
            }}
            onLoadError={(event) => {
              console.error('PaymentElement load error:', event);
              setElementError(event.error.message || 'Failed to load payment form');
            }}
            options={{
              layout: 'tabs',
            }}
          />
        </div>
        {elementError && (
          <div className="p-3 bg-amber-50 border-2 border-amber-600 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <span className="text-sm font-bold text-amber-700">{elementError}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border-2 border-rose-600 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
          <span className="text-sm font-bold text-rose-700">{error}</span>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <NeoButton
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={isProcessing}
          leftIcon={<X className="w-4 h-4" />}
        >
          Cancel
        </NeoButton>
        <NeoButton
          type="submit"
          variant="primary"
          disabled={!stripe || !isReady || isProcessing}
          leftIcon={isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          className="flex-1"
        >
          {isProcessing ? 'Saving...' : 'Save Payment Method'}
        </NeoButton>
      </div>

      <p className="text-xs text-center text-slate-500">
        Your payment details are securely processed by Stripe. We never see your card number.
      </p>
    </form>
  );
}

// Main component that wraps with Stripe Elements
export function StripePaymentForm({ teamId, onSuccess, onCancel }: PaymentFormProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config.stripePublishableKey) {
      if (import.meta.env.DEV) {
        console.warn('[Stripe] No publishable key configured');
      }
    }

    const fetchSetupIntent = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const { clientSecret } = await createSetupIntent(teamId);
        if (!clientSecret) {
          throw new Error('No client secret returned from server');
        }
        setClientSecret(clientSecret);
      } catch (err) {
        console.error('Failed to create setup intent:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize payment form');
      } finally {
        setIsLoading(false);
      }
    };

    if (teamId) {
      fetchSetupIntent();
    }
  }, [teamId]);

  if (!config.stripePublishableKey) {
    return (
      <div className="p-6 bg-amber-50 border-2 border-amber-600">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-amber-600" />
          <div>
            <div className="font-black text-amber-900 uppercase text-sm">Configuration Required</div>
            <div className="text-sm font-bold text-amber-700">
              Stripe publishable key not configured. Please set VITE_STRIPE_PUBLISHABLE_KEY.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Validate key format
  if (config.stripePublishableKey.startsWith('sk_')) {
    return (
      <div className="p-6 bg-rose-50 border-2 border-rose-600">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-rose-600" />
          <div>
            <div className="font-black text-rose-900 uppercase text-sm">Configuration Error</div>
            <div className="text-sm font-bold text-rose-700">
              VITE_STRIPE_PUBLISHABLE_KEY appears to be a SECRET key (starts with sk_).
              <br />
              You must use a PUBLISHABLE key (starts with pk_) for the frontend.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!config.stripePublishableKey.startsWith('pk_')) {
    return (
      <div className="p-6 bg-rose-50 border-2 border-rose-600">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-rose-600" />
          <div>
            <div className="font-black text-rose-900 uppercase text-sm">Configuration Error</div>
            <div className="text-sm font-bold text-rose-700">
              VITE_STRIPE_PUBLISHABLE_KEY does not appear to be a valid Stripe publishable key.
              <br />
              It should start with pk_ (e.g., pk_test_... or pk_live_...)
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
        <span className="font-bold text-slate-600">Setting up secure payment...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="p-4 bg-rose-50 border-2 border-rose-600 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 text-rose-600" />
          <div>
            <div className="font-black text-rose-900 uppercase text-sm">Error</div>
            <div className="text-sm font-bold text-rose-700">{error}</div>
          </div>
        </div>
        <div className="flex gap-3">
          <NeoButton variant="secondary" onClick={onCancel}>
            Cancel
          </NeoButton>
          <NeoButton variant="primary" onClick={() => window.location.reload()}>
            Retry
          </NeoButton>
        </div>
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div className="p-4 bg-rose-50 border-2 border-rose-600">
        <div className="text-sm font-bold text-rose-700">
          Failed to initialize payment form. Please try again.
        </div>
      </div>
    );
  }

  const stripePromise = getStripe();
  if (!stripePromise) {
    return (
      <div className="p-4 bg-amber-50 border-2 border-amber-600">
        <div className="text-sm font-bold text-amber-700">
          Stripe is not available. Please check your configuration.
        </div>
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#0f172a',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          },
        },
        loader: 'always', // Show loader while Stripe.js loads
      }}
    >
      <div className="w-full">
        <PaymentFormInner
          teamId={teamId}
          onSuccess={onSuccess}
          onCancel={onCancel}
        />
      </div>
    </Elements>
  );
}

// Export a modal wrapper for easy use
interface PaymentMethodModalProps {
  teamId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function PaymentMethodModal({ teamId, isOpen, onClose, onSuccess }: PaymentMethodModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl bg-white border-4 border-slate-900 shadow-[8px_8px_0_0_#000] my-auto max-h-[90vh] flex flex-col">
        <div className="p-6 border-b-4 border-slate-900 bg-slate-50 flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-600 flex items-center justify-center border-2 border-slate-900">
              <CreditCard className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-black uppercase tracking-tight">Add Payment Method</h2>
              <p className="text-sm font-bold text-slate-500">Securely save your card details</p>
            </div>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <StripePaymentForm
            teamId={teamId}
            onSuccess={() => {
              onSuccess();
              onClose();
            }}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
}

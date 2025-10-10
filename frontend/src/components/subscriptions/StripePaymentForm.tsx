import { useState } from 'react';
import {
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { CreditCard, Loader2 } from 'lucide-react';

interface StripePaymentFormProps {
  onSuccess: () => void;
  onError: (error: string) => void;
  amount: number;
  currency: string;
}

export function StripePaymentForm({
  onSuccess,
  onError,
  amount,
  currency,
}: StripePaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/subscription/payment/success`,
        },
      });

      if (error) {
        setErrorMessage(error.message || 'Payment failed');
        onError(error.message || 'Payment failed');
      } else {
        onSuccess();
      }
    } catch (err: any) {
      const message = err?.message || 'An unexpected error occurred';
      setErrorMessage(message);
      onError(message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="w-5 h-5 text-indigo-600" />
          <h3 className="text-lg font-semibold text-gray-900">Card Details</h3>
        </div>

        <PaymentElement
          options={{
            layout: 'tabs',
            paymentMethodOrder: ['card'],
          }}
        />

        {errorMessage && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{errorMessage}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
        <div>
          <p className="text-sm text-gray-600">Total Amount</p>
          <p className="text-2xl font-bold text-gray-900">
            {currency} {amount.toFixed(2)}
          </p>
        </div>
        <button
          type="submit"
          disabled={!stripe || !elements || isProcessing}
          className="px-8 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-semibold"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Processing...
            </>
          ) : (
            'Pay Now'
          )}
        </button>
      </div>
    </form>
  );
}

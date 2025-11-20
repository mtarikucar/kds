import { useState } from 'react';
import { PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { toast } from 'react-hot-toast';
import { LoadingSpinner } from '../common/LoadingSpinner';

interface PaymentFormProps {
  clientSecret: string;
  onSuccess: (paymentMethodId: string) => void;
  onCancel: () => void;
}

export function PaymentForm({ clientSecret, onSuccess, onCancel }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);

    try {
      // Confirm the payment
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: window.location.href,
        },
        redirect: 'if_required',
      });

      if (error) {
        toast.error(error.message || 'Payment failed');
        setIsProcessing(false);
        return;
      }

      if (paymentIntent && paymentIntent.status === 'succeeded') {
        onSuccess(paymentIntent.id);
      } else {
        toast.error('Payment not completed');
        setIsProcessing(false);
      }
    } catch (error: any) {
      toast.error('Payment processing error');
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-6">
        <PaymentElement />
      </div>

      <div className="flex gap-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={isProcessing}
          className="flex-1 py-3 px-6 border-2 border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Cancel
        </button>

        <button
          type="submit"
          disabled={!stripe || isProcessing}
          className="flex-1 py-3 px-6 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {isProcessing ? (
            <>
              <LoadingSpinner size="sm" />
              Processing...
            </>
          ) : (
            'Pay Now'
          )}
        </button>
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 text-sm text-gray-500">
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
        </svg>
        <span>Secured by Stripe</span>
      </div>
    </form>
  );
}

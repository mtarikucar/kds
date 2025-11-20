import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { StripePaymentForm } from '../../components/subscriptions/StripePaymentForm';
import { IyzicoPaymentForm } from '../../components/subscriptions/IyzicoPaymentForm';
import {
  useCreatePaymentIntent,
  useCreatePlanChangeIntent,
  useConfirmPayment,
} from '../../api/paymentsApi';
import { useGetCurrentSubscription, subscriptionKeys } from '../../features/subscriptions/subscriptionsApi';
import { useQueryClient } from '@tanstack/react-query';

// Initialize Stripe with your publishable key
const stripePromise = loadStripe(
  import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || 'pk_test_placeholder'
);

export default function SubscriptionPaymentPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const subscriptionId = searchParams.get('subscriptionId');
  const pendingChangeId = searchParams.get('pendingChangeId');
  const queryClient = useQueryClient();

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [currency, setCurrency] = useState<string>('USD');
  const [paymentProvider, setPaymentProvider] = useState<'stripe' | 'iyzico'>(
    'stripe'
  );
  const [paymentStatus, setPaymentStatus] = useState<
    'idle' | 'processing' | 'success' | 'error'
  >('idle');
  const [isPlanChange, setIsPlanChange] = useState(false);

  const { data: subscription } = useGetCurrentSubscription();
  const createPaymentIntent = useCreatePaymentIntent();
  const createPlanChangeIntent = useCreatePlanChangeIntent();
  const confirmPayment = useConfirmPayment();

  // Create payment intent on mount
  useEffect(() => {
    if (pendingChangeId) {
      // Handle plan change payment
      setIsPlanChange(true);

      // Use API hook for plan change payment intent
      createPlanChangeIntent.mutate(
        { pendingChangeId },
        {
          onSuccess: (data) => {
            setClientSecret(data.clientSecret);
            setPaymentIntentId(data.paymentIntentId);
            setAmount(data.amount);
            setCurrency(data.currency);
            setPaymentProvider(data.paymentProvider || 'stripe');
          },
          onError: (error) => {
            toast.error('Failed to create payment intent');
            navigate('/subscription');
          },
        }
      );
    } else if (subscriptionId) {
      // Handle new subscription payment
      setIsPlanChange(false);

      createPaymentIntent.mutate(
        { subscriptionId },
        {
          onSuccess: (data) => {
            setClientSecret(data.clientSecret);
            setPaymentIntentId(data.paymentIntentId);
            setAmount(data.amount);
            setCurrency(data.currency);

            // Determine payment provider based on currency
            if (data.currency === 'TRY') {
              setPaymentProvider('iyzico');
            } else {
              setPaymentProvider('stripe');
            }
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.message || 'Failed to create payment intent');
            navigate('/subscription/plans');
          },
        }
      );
    } else {
      toast.error('No payment information provided');
      navigate('/subscription/plans');
    }
  }, [subscriptionId, pendingChangeId]);

  const handleStripeSuccess = async () => {
    setPaymentStatus('processing');

    if (isPlanChange && pendingChangeId) {
      toast.success('Payment confirmed! Applying plan change...');

      // Apply the plan change
      try {
        await fetch(`/api/subscriptions/apply-plan-change/${pendingChangeId}`, {
          method: 'POST',
        });

        // Invalidate subscription cache to refresh the UI
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });

        setPaymentStatus('success');
        setTimeout(() => {
          navigate('/subscription');
        }, 2000);
      } catch (error) {
        setPaymentStatus('error');
        toast.error('Failed to apply plan change');
      }
    } else {
      toast.success('Payment confirmed! Activating subscription...');

      // Invalidate subscription cache
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });

      // Wait a moment for webhook to process
      setTimeout(() => {
        setPaymentStatus('success');
        setTimeout(() => {
          navigate('/subscription');
        }, 2000);
      }, 2000);
    }
  };

  const handleStripeError = (error: string) => {
    setPaymentStatus('error');
    toast.error(error);
  };

  const handleIyzicoSubmit = async (data: any) => {
    if (!paymentIntentId && !pendingChangeId) return;

    setPaymentStatus('processing');

    if (isPlanChange && pendingChangeId) {
      // Handle plan change payment with iyzico
      try {
        const response = await fetch('/api/payments/confirm-plan-change-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pendingChangeId,
            iyzicoDetails: {
              cardHolderName: data.cardHolderName,
              cardNumber: data.cardNumber.replace(/\s/g, ''),
              expireMonth: data.expireMonth,
              expireYear: data.expireYear,
              cvc: data.cvc,
            },
          }),
        });

        if (response.ok) {
          const result = await response.json();
          // Apply the plan change
          await fetch(`/api/subscriptions/apply-plan-change/${pendingChangeId}`, {
            method: 'POST',
          });

          // Invalidate subscription cache to refresh the UI
          queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
          queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });

          setPaymentStatus('success');
          toast.success('Ödeme başarılı! Plan değişikliği uygulanıyor...');
          setTimeout(() => {
            navigate('/subscription');
          }, 2000);
        } else {
          throw new Error('Payment failed');
        }
      } catch (error) {
        setPaymentStatus('error');
        toast.error('Ödeme başarısız oldu');
      }
    } else {
      // Handle new subscription payment with iyzico
      confirmPayment.mutate(
        {
          paymentIntentId,
          iyzicoPaymentDetails: {
            cardHolderName: data.cardHolderName,
            cardNumber: data.cardNumber.replace(/\s/g, ''),
            expireMonth: data.expireMonth,
            expireYear: data.expireYear,
            cvc: data.cvc,
          },
        },
        {
          onSuccess: () => {
            // Invalidate subscription cache
            queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
            queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });

            setPaymentStatus('success');
            toast.success('Ödeme başarılı! Aboneliğiniz aktif ediliyor...');
            setTimeout(() => {
              navigate('/subscription');
            }, 2000);
          },
          onError: (error: any) => {
            setPaymentStatus('error');
            toast.error(
              error.response?.data?.message || 'Ödeme başarısız oldu'
            );
          },
        }
      );
    }
  };

  if (createPaymentIntent.isPending) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mx-auto mb-4" />
          <p className="text-gray-600">Preparing payment...</p>
        </div>
      </div>
    );
  }

  if (paymentStatus === 'success') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Payment Successful!
          </h2>
          <p className="text-gray-600 mb-6">
            Your subscription has been activated successfully.
          </p>
          <button
            onClick={() => navigate('/subscription')}
            className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Go to Subscription
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-3xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/subscription/plans')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Plans
          </button>
          <h1 className="text-3xl font-bold text-gray-900">
            Complete Your Payment
          </h1>
          <p className="text-gray-600 mt-2">
            {paymentProvider === 'stripe'
              ? 'Securely process your payment with Stripe'
              : 'İyzico ile güvenli ödeme yapın'}
          </p>
        </div>

        {/* Payment Form */}
        {paymentProvider === 'stripe' && clientSecret ? (
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: {
                theme: 'stripe',
                variables: {
                  colorPrimary: '#4F46E5',
                },
              },
            }}
          >
            <StripePaymentForm
              onSuccess={handleStripeSuccess}
              onError={handleStripeError}
              amount={amount}
              currency={currency}
            />
          </Elements>
        ) : paymentProvider === 'iyzico' ? (
          <IyzicoPaymentForm
            onSubmit={handleIyzicoSubmit}
            amount={amount}
            currency={currency}
            isProcessing={paymentStatus === 'processing'}
          />
        ) : (
          <div className="bg-white rounded-lg p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading payment form...</p>
          </div>
        )}

        {/* Security Notice */}
        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-blue-900 mb-1">
                Secure Payment
              </h3>
              <p className="text-sm text-blue-800">
                {paymentProvider === 'stripe'
                  ? 'Your payment information is encrypted and processed securely by Stripe. We never store your card details.'
                  : 'Ödeme bilgileriniz İyzico tarafından güvenli bir şekilde işlenir. Kart bilgileriniz saklanmaz.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

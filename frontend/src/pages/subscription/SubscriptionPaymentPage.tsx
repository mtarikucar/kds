import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { StripePaymentForm } from '../../components/subscriptions/StripePaymentForm';
import { PaytrRedirect } from '../../components/subscriptions/PaytrRedirect';
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
  const planId = searchParams.get('planId');
  const billingCycle = searchParams.get('billingCycle');
  const pendingChangeId = searchParams.get('pendingChangeId');
  const queryClient = useQueryClient();

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [paytrPaymentLink, setPaytrPaymentLink] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [currency, setCurrency] = useState<string>('TRY');
  const [planName, setPlanName] = useState<string>('');
  const [paymentProvider, setPaymentProvider] = useState<'STRIPE' | 'PAYTR'>('PAYTR');
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

      createPlanChangeIntent.mutate(
        { pendingChangeId },
        {
          onSuccess: (data) => {
            setAmount(data.amount);
            setCurrency(data.currency);
            setPaymentProvider(data.provider);

            if (data.provider === 'PAYTR') {
              setPaytrPaymentLink(data.paymentLink);
            } else {
              setClientSecret(data.clientSecret);
              setPaymentIntentId(data.paymentIntentId);
            }
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.message || 'Odeme olusturulamadi');
            navigate('/subscription');
          },
        }
      );
    } else if (planId && billingCycle) {
      // Handle new subscription payment
      setIsPlanChange(false);

      createPaymentIntent.mutate(
        { planId, billingCycle: billingCycle as 'MONTHLY' | 'YEARLY' },
        {
          onSuccess: (data) => {
            setAmount(data.amount);
            setCurrency(data.currency);
            setPaymentProvider(data.provider);

            if (data.provider === 'PAYTR') {
              setPaytrPaymentLink(data.paymentLink);
            } else {
              setClientSecret(data.clientSecret);
              setPaymentIntentId(data.paymentIntentId);
            }
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.message || 'Odeme olusturulamadi');
            navigate('/subscription/plans');
          },
        }
      );
    } else {
      toast.error('Eksik odeme bilgisi');
      navigate('/subscription/plans');
    }
  }, [planId, billingCycle, pendingChangeId]);

  const handleStripeSuccess = async () => {
    setPaymentStatus('processing');

    if (isPlanChange && pendingChangeId) {
      toast.success('Odeme onaylandi! Plan degisikligi uygulaniyor...');

      try {
        await fetch(`/api/subscriptions/apply-plan-change/${pendingChangeId}`, {
          method: 'POST',
        });

        queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
        queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });

        setPaymentStatus('success');
        setTimeout(() => {
          navigate('/subscription');
        }, 2000);
      } catch (error) {
        setPaymentStatus('error');
        toast.error('Plan degisikligi uygulanamadi');
      }
    } else {
      toast.success('Odeme onaylandi! Abonelik aktif ediliyor...');

      queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });

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

  if (createPaymentIntent.isPending || createPlanChangeIntent.isPending) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mx-auto mb-4" />
          <p className="text-gray-600">Odeme hazirlaniyor...</p>
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
            Odeme Basarili!
          </h2>
          <p className="text-gray-600 mb-6">
            Aboneliginiz basariyla aktif edildi.
          </p>
          <button
            onClick={() => navigate('/subscription')}
            className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Abonelige Git
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
            Planlara Don
          </button>
          <h1 className="text-3xl font-bold text-gray-900">
            Odemenizi Tamamlayin
          </h1>
          <p className="text-gray-600 mt-2">
            {paymentProvider === 'STRIPE'
              ? 'Stripe ile guvenli odeme yapin'
              : 'PayTR ile guvenli odeme yapin'}
          </p>
        </div>

        {/* Payment Form */}
        {paymentProvider === 'STRIPE' && clientSecret ? (
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
        ) : paymentProvider === 'PAYTR' && paytrPaymentLink ? (
          <PaytrRedirect
            paymentLink={paytrPaymentLink}
            amount={amount}
            currency={currency}
            planName={planName}
          />
        ) : (
          <div className="bg-white rounded-lg p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto mb-4" />
            <p className="text-gray-600">Odeme formu yukleniyor...</p>
          </div>
        )}

        {/* Security Notice */}
        <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-blue-900 mb-1">
                Guvenli Odeme
              </h3>
              <p className="text-sm text-blue-800">
                {paymentProvider === 'STRIPE'
                  ? 'Odeme bilgileriniz Stripe tarafindan guvenli bir sekilde islenir. Kart bilgileriniz bizde saklanmaz.'
                  : 'Odeme bilgileriniz PayTR tarafindan guvenli bir sekilde islenir. Kart bilgileriniz bizde saklanmaz.'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

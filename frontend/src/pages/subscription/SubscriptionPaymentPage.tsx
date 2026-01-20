import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, AlertCircle, Loader2, Mail } from 'lucide-react';
import { PaytrRedirect } from '../../components/subscriptions/PaytrRedirect';
import {
  useCreatePaymentIntent,
  useCreateUpgradeIntent,
} from '../../api/paymentsApi';
import { useGetCurrentSubscription, subscriptionKeys } from '../../features/subscriptions/subscriptionsApi';
import { useQueryClient } from '@tanstack/react-query';

export default function SubscriptionPaymentPage() {
  const { t } = useTranslation('subscriptions');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const planId = searchParams.get('planId');
  const billingCycle = searchParams.get('billingCycle');
  // Upgrade parameters
  const type = searchParams.get('type');
  const subscriptionId = searchParams.get('subscriptionId');
  const newPlanId = searchParams.get('newPlanId');
  const upgradeAmount = searchParams.get('amount');
  const queryClient = useQueryClient();

  const [paytrPaymentLink, setPaytrPaymentLink] = useState<string | null>(null);
  const [amount, setAmount] = useState<number>(0);
  const [currency, setCurrency] = useState<string>('TRY');
  const [planName, setPlanName] = useState<string>('');
  const [paymentProvider, setPaymentProvider] = useState<'PAYTR' | 'EMAIL'>('PAYTR');
  const [emailMessage, setEmailMessage] = useState<string>('');
  const [paymentStatus, setPaymentStatus] = useState<
    'idle' | 'processing' | 'success' | 'error' | 'email_sent'
  >('idle');
  const [isPlanChange, setIsPlanChange] = useState(false);

  const { data: subscription } = useGetCurrentSubscription();
  const createPaymentIntent = useCreatePaymentIntent();
  const createUpgradeIntent = useCreateUpgradeIntent();

  // Create payment intent on mount
  useEffect(() => {
    if (type === 'upgrade' && subscriptionId && newPlanId && billingCycle && upgradeAmount) {
      // Handle upgrade payment
      setIsPlanChange(true);

      createUpgradeIntent.mutate(
        {
          subscriptionId,
          newPlanId,
          billingCycle,
          amount: parseFloat(upgradeAmount),
        },
        {
          onSuccess: (data) => {
            setAmount(data.amount);
            setCurrency(data.currency);
            setPaymentProvider(data.provider);

            if (data.provider === 'EMAIL') {
              setEmailMessage(data.message);
              setPaymentStatus('email_sent');
            } else if (data.provider === 'PAYTR') {
              setPaytrPaymentLink(data.paymentLink);
            }
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.message || t('subscriptions.payment.paymentCreationFailed'));
            navigate('/admin/settings/subscription');
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

            if (data.provider === 'EMAIL') {
              setEmailMessage(data.message);
              setPaymentStatus('email_sent');
            } else if (data.provider === 'PAYTR') {
              setPaytrPaymentLink(data.paymentLink);
            }
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.message || t('subscriptions.payment.paymentCreationFailed'));
            navigate('/subscription/plans');
          },
        }
      );
    } else {
      toast.error(t('subscriptions.payment.missingPaymentInfo'));
      navigate('/subscription/plans');
    }
  }, [planId, billingCycle, type, subscriptionId, newPlanId, upgradeAmount]);

  if (createPaymentIntent.isPending || createUpgradeIntent.isPending) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mx-auto mb-4" />
          <p className="text-gray-600">{t('subscriptions.payment.preparing')}</p>
        </div>
      </div>
    );
  }

  // Email request sent - show confirmation for international customers
  if (paymentStatus === 'email_sent') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="max-w-md w-full bg-card rounded-lg shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Mail className="w-8 h-8 text-primary-600" />
          </div>
          <h2 className="text-2xl font-bold font-heading text-foreground mb-2">
            {t('subscriptions.payment.requestSubmitted', 'Request Submitted')}
          </h2>
          <p className="text-gray-600 mb-6">
            {emailMessage || t('subscriptions.payment.contactSoon', 'Our team will contact you shortly to complete the payment process.')}
          </p>
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-6 text-left">
            <h3 className="font-semibold text-primary-900 mb-2">
              {t('subscriptions.payment.whatHappensNext', 'What happens next?')}
            </h3>
            <ul className="text-sm text-primary-800 space-y-2">
              <li>• {t('subscriptions.payment.step1', 'You will receive a confirmation email')}</li>
              <li>• {t('subscriptions.payment.step2', 'Our team will contact you within 24 hours')}</li>
              <li>• {t('subscriptions.payment.step3', 'We will arrange payment via bank transfer or other methods')}</li>
              <li>• {t('subscriptions.payment.step4', 'Your subscription will be activated once payment is confirmed')}</li>
            </ul>
          </div>
          <button
            onClick={() => navigate('/admin/settings/subscription')}
            className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            {t('subscriptions.payment.goToSubscription')}
          </button>
        </div>
      </div>
    );
  }

  if (paymentStatus === 'success') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="max-w-md w-full bg-card rounded-lg shadow-lg p-8 text-center">
          <CheckCircle2 className="w-16 h-16 text-accent-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold font-heading text-foreground mb-2">
            {t('subscriptions.payment.success.title')}
          </h2>
          <p className="text-gray-600 mb-6">
            {t('subscriptions.payment.success.subscriptionActive')}
          </p>
          <button
            onClick={() => navigate('/admin/settings/subscription')}
            className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            {t('subscriptions.payment.goToSubscription')}
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
            {t('subscriptions.payment.backToPlans')}
          </button>
          <h1 className="text-3xl font-bold font-heading text-foreground">
            {t('subscriptions.payment.completePayment')}
          </h1>
          <p className="text-gray-600 mt-2">
            {t('subscriptions.payment.securePaymentWith')} PayTR
          </p>
        </div>

        {/* Payment Form */}
        {paymentProvider === 'PAYTR' && paytrPaymentLink ? (
          <PaytrRedirect
            paymentLink={paytrPaymentLink}
            amount={amount}
            currency={currency}
            planName={planName}
          />
        ) : (
          <div className="bg-white rounded-lg p-8 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600 mx-auto mb-4" />
            <p className="text-gray-600">{t('subscriptions.payment.loadingForm')}</p>
          </div>
        )}

        {/* Security Notice */}
        <div className="mt-8 p-4 bg-primary-50 border border-primary-200 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-primary-500 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-primary-900 mb-1">
                {t('subscriptions.payment.securePaymentTitle')}
              </h3>
              <p className="text-sm text-primary-800">
                {t('subscriptions.payment.securePaymentDescPaytr')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

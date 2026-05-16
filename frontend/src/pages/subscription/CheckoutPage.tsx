import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, Lock } from 'lucide-react';
import { useCreatePaymentIntent } from '../../api/paymentsApi';
import Spinner from '../../components/ui/Spinner';
import Button from '../../components/ui/Button';
import { BillingCycle } from '../../types';

const AUTO_REDIRECT_MS = 3000;

/**
 * Sits between plan selection and PayTR's hosted page. Two phases:
 *   1. Create intent (spinner) — exchanges the (planId, billingCycle)
 *      URL params for a server-issued paymentLink.
 *   2. Confirm screen — gives the user 3 seconds to read what's about
 *      to happen before redirecting (and a manual button if they want
 *      to skip the wait).
 *
 * Trial short-circuit skips phase 2 entirely.
 */
const CheckoutPage = () => {
  const { t } = useTranslation('subscriptions');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const planId = params.get('planId');
  const billingCycle = (params.get('billingCycle') ?? BillingCycle.MONTHLY) as BillingCycle;
  const createIntent = useCreatePaymentIntent();
  const [error, setError] = useState<string | null>(null);
  const [paymentLink, setPaymentLink] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(AUTO_REDIRECT_MS / 1000);

  useEffect(() => {
    if (!planId) {
      navigate('/subscription/plans', { replace: true });
      return;
    }
    createIntent.mutate(
      { planId, billingCycle },
      {
        onSuccess: (data) => {
          if (data.provider === 'TRIAL') {
            navigate('/admin/settings/subscription', { replace: true });
            return;
          }
          if (data.paymentLink) {
            // Stage the link for the confirm screen instead of redirecting
            // immediately. The countdown effect below handles the auto-go.
            setPaymentLink(data.paymentLink);
          } else {
            setError(t('subscriptions.checkout.missingLink'));
          }
        },
        onError: (err: any) => {
          setError(err?.response?.data?.message ?? err?.message ?? 'Payment intent failed');
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, billingCycle]);

  // Countdown → auto-redirect once we have a payment link.
  useEffect(() => {
    if (!paymentLink) return;
    const tick = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(tick);
          window.location.href = paymentLink;
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [paymentLink]);

  if (error) {
    return (
      <div className="max-w-md mx-auto mt-20 text-center">
        <h1 className="text-2xl font-bold text-slate-900 mb-4">
          {t('subscriptions.checkout.errorTitle')}
        </h1>
        <p className="text-slate-600 mb-6">{error}</p>
        <Button variant="primary" onClick={() => navigate('/subscription/plans')}>
          {t('subscriptions.checkout.backToPlans')}
        </Button>
      </div>
    );
  }

  // Phase 2: confirm screen.
  if (paymentLink) {
    return (
      <div className="max-w-md mx-auto mt-20 px-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-indigo-100 flex items-center justify-center">
            <ShieldCheck className="w-8 h-8 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">
            {t('subscriptions.checkout.confirmTitle')}
          </h1>
          <p className="text-slate-600 mb-6">
            {t('subscriptions.checkout.confirmBody')}
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500 mb-6">
            <Lock className="w-4 h-4" />
            <span>{t('subscriptions.checkout.secureNote')}</span>
          </div>
          <Button
            variant="primary"
            className="w-full"
            onClick={() => {
              window.location.href = paymentLink;
            }}
          >
            {t('subscriptions.checkout.proceedNow', { seconds: countdown })}
          </Button>
          <button
            onClick={() => navigate('/subscription/plans')}
            className="mt-3 text-sm text-slate-500 hover:text-slate-700 underline"
          >
            {t('subscriptions.checkout.cancel')}
          </button>
        </div>
      </div>
    );
  }

  // Phase 1: creating intent.
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <Spinner size="lg" />
      <p className="mt-6 text-slate-600">{t('subscriptions.checkout.preparing')}</p>
    </div>
  );
};

export default CheckoutPage;

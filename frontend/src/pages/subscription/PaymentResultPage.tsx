import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, XCircle } from 'lucide-react';
import {
  useGetCurrentSubscription,
  subscriptionKeys,
} from '../../features/subscriptions/subscriptionsApi';
import { useQueryClient } from '@tanstack/react-query';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';

interface PaymentResultPageProps {
  outcome: 'success' | 'failed';
}

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

/**
 * Landing page after PayTR redirects the user back. The redirect is
 * just a UX cue — the source of truth is the webhook, which may arrive
 * before, during, or after this page mounts. So we poll
 * /subscriptions/current until status flips to ACTIVE (success path) or
 * a short timeout elapses (fail path).
 */
const PaymentResultPage = ({ outcome }: PaymentResultPageProps) => {
  const { t } = useTranslation('subscriptions');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: subscription } = useGetCurrentSubscription();
  const [timedOut, setTimedOut] = useState(false);
  // Step text changes over time so the user doesn't feel "stuck on a
  // spinner". Three stages mapping to elapsed-time buckets.
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  // Treat both ACTIVE (real payment confirmed) and TRIALING (trial path
  // short-circuit) as "live" — the webhook may upgrade the existing
  // TRIALING sub or never run at all for the trial flow.
  const isLive =
    subscription?.status === 'ACTIVE' || subscription?.status === 'TRIALING';

  useEffect(() => {
    if (outcome !== 'success' || isLive) return;
    const start = Date.now();
    const tick = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
      queryClient.invalidateQueries({ queryKey: subscriptionKeys.effectiveFeatures() });
      const elapsed = Date.now() - start;
      // Bucket the elapsed time into 3 reassurance stages.
      if (elapsed > 20_000) setStage(2);
      else if (elapsed > 10_000) setStage(1);
      if (elapsed > POLL_TIMEOUT_MS) {
        setTimedOut(true);
        clearInterval(tick);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(tick);
  }, [outcome, isLive, queryClient]);

  if (outcome === 'success' && !isLive && !timedOut) {
    // Progressive reassurance: short → longer wait copy → "may be slow".
    const stageHints: string[] = [
      t('subscriptions.paymentResult.confirmingHint'),
      t('subscriptions.paymentResult.confirmingStage2'),
      t('subscriptions.paymentResult.confirmingStage3'),
    ];
    return (
      <div className="max-w-md mx-auto mt-20 text-center">
        <Spinner size="lg" />
        <h1 className="text-2xl font-bold text-slate-900 mt-6 mb-2">
          {t('subscriptions.paymentResult.confirming')}
        </h1>
        <p className="text-slate-600">{stageHints[stage]}</p>
      </div>
    );
  }

  const isSuccess = outcome === 'success' && isLive;

  return (
    <div className="max-w-md mx-auto mt-20 text-center">
      {isSuccess ? (
        <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
      ) : (
        <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
      )}
      <h1 className="text-2xl font-bold text-slate-900 mb-2">
        {isSuccess
          ? t('subscriptions.paymentResult.successTitle')
          : t('subscriptions.paymentResult.failTitle')}
      </h1>
      <p className="text-slate-600 mb-6">
        {isSuccess
          ? t('subscriptions.paymentResult.successBody')
          : t('subscriptions.paymentResult.failBody')}
      </p>
      <Button
        variant="primary"
        onClick={() =>
          isSuccess
            ? navigate('/admin/settings/subscription')
            : navigate('/subscription/plans')
        }
      >
        {isSuccess
          ? t('subscriptions.paymentResult.goToSubscription')
          : t('subscriptions.paymentResult.tryAgain')}
      </Button>
    </div>
  );
};

export default PaymentResultPage;

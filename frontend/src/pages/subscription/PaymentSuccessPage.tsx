import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Loader2, ArrowRight } from 'lucide-react';
import { subscriptionKeys } from '../../features/subscriptions/subscriptionsApi';

export default function PaymentSuccessPage() {
  const { t } = useTranslation('subscriptions');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [isVerifying, setIsVerifying] = useState(true);

  const merchantOid = searchParams.get('oid');
  const type = searchParams.get('type');

  useEffect(() => {
    // Invalidate subscription cache to get updated status
    queryClient.invalidateQueries({ queryKey: subscriptionKeys.current() });
    queryClient.invalidateQueries({ queryKey: subscriptionKeys.all });

    // Small delay to allow webhook to process
    const timer = setTimeout(() => {
      setIsVerifying(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, [queryClient]);

  if (isVerifying) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mx-auto mb-4" />
          <p className="text-gray-600">{t('subscriptions.payment.verifying')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        {/* Success Icon */}
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <CheckCircle2 className="w-12 h-12 text-green-500" />
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {t('subscriptions.payment.success.title')}
        </h2>

        {/* Description */}
        <p className="text-gray-600 mb-6">
          {type === 'plan_change'
            ? t('subscriptions.payment.success.planChangeComplete')
            : t('subscriptions.payment.success.subscriptionActive')}
        </p>

        {/* Order Reference */}
        {merchantOid && (
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <p className="text-sm text-gray-500 mb-1">{t('subscriptions.payment.orderReference')}</p>
            <p className="text-sm font-mono text-gray-700">{merchantOid}</p>
          </div>
        )}

        {/* CTA Button */}
        <button
          onClick={() => navigate('/subscription')}
          className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
        >
          {t('subscriptions.payment.goToSubscription')}
          <ArrowRight className="w-5 h-5" />
        </button>

        {/* Dashboard Link */}
        <button
          onClick={() => navigate('/dashboard')}
          className="w-full mt-3 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
        >
          {t('subscriptions.payment.success.goToDashboard')}
        </button>
      </div>
    </div>
  );
}

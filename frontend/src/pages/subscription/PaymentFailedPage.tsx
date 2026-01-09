import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { XCircle, RefreshCw, ArrowLeft, HelpCircle } from 'lucide-react';

export default function PaymentFailedPage() {
  const { t } = useTranslation('subscriptions');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const merchantOid = searchParams.get('oid');
  const type = searchParams.get('type');
  const pendingChangeIdParam = searchParams.get('pendingChangeId');

  // Extract pendingChangeId from merchantOid if it's a plan change (PLAN-{id}-{timestamp})
  const getPendingChangeId = () => {
    if (pendingChangeIdParam) return pendingChangeIdParam;
    if (merchantOid && merchantOid.startsWith('PLAN-')) {
      const parts = merchantOid.split('-');
      if (parts.length >= 2) {
        return parts[1];
      }
    }
    return null;
  };

  const pendingChangeId = getPendingChangeId();
  const isPlanChange = type === 'plan-change' || !!pendingChangeId;

  const handleTryAgain = () => {
    if (isPlanChange && pendingChangeId) {
      // For plan changes, go to payment with pending change context
      navigate(`/subscription/payment?pendingChangeId=${pendingChangeId}`);
    } else {
      // For new subscriptions, go back to plans
      navigate('/subscription/plans');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        {/* Error Icon */}
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <XCircle className="w-12 h-12 text-red-500" />
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {t('subscriptions.payment.failed.title')}
        </h2>

        {/* Description */}
        <p className="text-gray-600 mb-6">
          {t('subscriptions.payment.failed.description')}
        </p>

        {/* Possible Reasons */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
          <ul className="text-sm text-gray-600 space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">-</span>
              <span>{t('subscriptions.payment.failed.incorrectCard')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">-</span>
              <span>{t('subscriptions.payment.failed.insufficientBalance')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">-</span>
              <span>{t('subscriptions.payment.failed.bankRejected')}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">-</span>
              <span>{t('subscriptions.payment.failed.3dSecureFailed')}</span>
            </li>
          </ul>
        </div>

        {/* Order Reference */}
        {merchantOid && (
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <p className="text-sm text-gray-500 mb-1">{t('subscriptions.payment.orderReference')}</p>
            <p className="text-sm font-mono text-gray-700">{merchantOid}</p>
          </div>
        )}

        {/* CTA Buttons */}
        <div className="space-y-3">
          <button
            onClick={handleTryAgain}
            className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-5 h-5" />
            {t('subscriptions.payment.failed.tryAgain')}
          </button>

          <button
            onClick={() => navigate('/settings/subscription')}
            className="w-full px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-5 h-5" />
            {t('subscriptions.payment.failed.goBack')}
          </button>
        </div>

        {/* Help Link */}
        <div className="mt-6 pt-6 border-t border-gray-200">
          <a
            href="/contact"
            className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
          >
            <HelpCircle className="w-4 h-4" />
            {t('subscriptions.payment.failed.contactSupport')}
          </a>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, Loader2, CreditCard } from 'lucide-react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useCartStore } from '../../store/cartStore';
import { useSessionPayStatus } from '../../features/qr-menu/customerPayApi';
import { formatCurrency } from '../../lib/utils';

interface QrPaymentResultPageProps {
  subdomain?: string;
}

const QrPaymentResultPage: React.FC<QrPaymentResultPageProps> = ({ subdomain }) => {
  const { t } = useTranslation('common');
  const { tenantId: tenantParam } = useParams<{ tenantId: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const sessionId = useCartStore((s) => s.sessionId);
  const currency = useCartStore((s) => s.currency) || 'TRY';

  const merchantOid = params.get('oid');
  const explicitStatus = params.get('status'); // PayTR fail_url passes status=failed

  const { data, isError } = useSessionPayStatus(
    sessionId,
    merchantOid,
    !!sessionId && !!merchantOid,
  );

  const ordersUrl = subdomain
    ? '/orders'
    : `/qr-menu/${tenantParam}/orders`;

  // Auto-bounce back to orders after success, giving the customer a
  // chance to read the confirmation. 8 seconds feels right on a phone.
  useEffect(() => {
    if (data?.status === 'SUCCEEDED') {
      const remaining = data?.remaining?.summary?.remainingQuantity ?? 0;
      if (remaining === 0) {
        const t = setTimeout(() => navigate(ordersUrl), 8000);
        return () => clearTimeout(t);
      }
    }
  }, [data?.status, data?.remaining?.summary?.remainingQuantity, navigate, ordersUrl]);

  const status = data?.status ?? (explicitStatus === 'failed' ? 'FAILED' : 'PENDING');
  const remainingAmount = data?.remaining?.summary?.remainingAmount;
  const remainingQty = data?.remaining?.summary?.remainingQuantity ?? 0;
  const paidAmount = data?.amount;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-xl max-w-md w-full p-6 sm:p-8 text-center"
      >
        {status === 'PENDING' && (
          <>
            <Loader2 className="h-12 w-12 text-indigo-500 mx-auto mb-4 animate-spin" />
            <h2 className="text-xl font-bold text-slate-900 mb-2">
              {t('payment.result.checking', 'Confirming your payment…')}
            </h2>
            <p className="text-sm text-slate-500">
              {t(
                'payment.result.checkingDetail',
                'Waiting for PayTR to confirm. This usually takes a few seconds.',
              )}
            </p>
          </>
        )}

        {status === 'SUCCEEDED' && (
          <>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', damping: 12, delay: 0.1 }}
              className="inline-flex p-4 rounded-full bg-emerald-100 mb-4"
            >
              <CheckCircle2 className="h-12 w-12 text-emerald-600" />
            </motion.div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              {t('payment.result.success', 'Payment received!')}
            </h2>
            {paidAmount && (
              <p className="text-sm text-slate-500 mb-1">
                {t('payment.result.youPaid', 'You paid')}{' '}
                <span className="font-bold text-emerald-700">
                  {formatCurrency(parseFloat(paidAmount), currency)}
                </span>
              </p>
            )}
            {remainingQty > 0 && remainingAmount && (
              <p className="text-sm text-slate-500 mt-2">
                {t('payment.result.successWithRemaining', 'Remaining on table:')}{' '}
                <span className="font-bold text-indigo-700">
                  {formatCurrency(parseFloat(remainingAmount), currency)}
                </span>
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2">
              {remainingQty > 0 ? (
                <button
                  onClick={() => navigate(ordersUrl)}
                  className="w-full py-3 rounded-xl bg-indigo-500 text-white font-bold flex items-center justify-center gap-2"
                >
                  <CreditCard className="h-5 w-5" />
                  {t('payment.result.payRemaining', 'Pay the rest')}
                </button>
              ) : (
                <p className="text-sm text-emerald-700 font-medium">
                  {t('payment.result.enjoy', 'Enjoy your meal! 🍽️')}
                </p>
              )}
              <button
                onClick={() => navigate(ordersUrl)}
                className="w-full py-3 rounded-xl bg-slate-100 text-slate-700 font-medium"
              >
                {t('payment.result.backToOrders', 'Back to my orders')}
              </button>
            </div>
          </>
        )}

        {status === 'FAILED' && (
          <>
            <div className="inline-flex p-4 rounded-full bg-red-100 mb-4">
              <XCircle className="h-12 w-12 text-red-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              {t('payment.result.failed', 'Payment failed')}
            </h2>
            <p className="text-sm text-slate-500">
              {/* Map server-coded failureReason to a localized message.
                  Unknown codes fall through to the generic detail. */}
              {(() => {
                const code = data?.failureReason;
                const knownCodes = [
                  'expired',
                  'paytr_token_error',
                  'settlement_error',
                  'paytr_reported_failure',
                ];
                if (code && knownCodes.includes(code)) {
                  return t(`payment.result.errors.${code}`);
                }
                return t(
                  'payment.result.failedDetail',
                  'Your card was not charged. You can try again from your orders page.',
                );
              })()}
            </p>
            <button
              onClick={() => navigate(ordersUrl)}
              className="mt-6 w-full py-3 rounded-xl bg-indigo-500 text-white font-bold"
            >
              {t('payment.result.tryAgain', 'Try again')}
            </button>
          </>
        )}

        {status === 'EXPIRED' && (
          <>
            <div className="inline-flex p-4 rounded-full bg-amber-100 mb-4">
              <XCircle className="h-12 w-12 text-amber-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">
              {t('payment.result.expired', 'Payment session expired')}
            </h2>
            <p className="text-sm text-slate-500">
              {t(
                'payment.result.expiredDetail',
                'You took too long at the payment page. Your card was not charged; start a new payment from your orders.',
              )}
            </p>
            <button
              onClick={() => navigate(ordersUrl)}
              className="mt-6 w-full py-3 rounded-xl bg-indigo-500 text-white font-bold"
            >
              {t('payment.result.backToOrders', 'Back to my orders')}
            </button>
          </>
        )}

        {isError && status === 'PENDING' && (
          <p className="text-xs text-red-500 mt-4">
            {t('payment.result.checkError', "Couldn't reach the server. Retrying…")}
          </p>
        )}
      </motion.div>
    </div>
  );
};

export default QrPaymentResultPage;

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import Spinner from '../../components/ui/Spinner';
import { useListHardwareOrders } from './storeApi';
import { useCartStore } from './cartStore';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;

/**
 * Landing panel shown on /admin/store?tab=hardware&intent=<ref> once PayTR
 * redirects the buyer back from a hardware checkout.
 *
 * PayTR's okUrl/failUrl are the SAME static returnUrl regardless of outcome
 * (see paytr-payment-provider.ts + checkoutRef.ts), so the redirect itself
 * carries no verdict. The source of truth is whether
 * CheckoutSettlementService has provisioned a HardwareOrder for this
 * paymentRef yet. There's no GET-by-ref endpoint for CheckoutIntent, so —
 * mirroring subscription's PaymentResultPage poll-with-timeout pattern —
 * this polls the tenant's existing order list (already available,
 * read-only) and matches on paymentRef instead of hitting a dedicated
 * status endpoint.
 */
export default function HardwareCheckoutResult({
  paymentRef,
  onContinue,
}: {
  paymentRef: string;
  onContinue: () => void;
}) {
  const { t } = useTranslation('hardware');
  const { data: orders = [], refetch } = useListHardwareOrders();
  const [timedOut, setTimedOut] = useState(false);

  const matchedOrder = orders.find((o) => o.paymentRef === paymentRef);
  const status: 'pending' | 'success' | 'failed' = matchedOrder
    ? 'success'
    : timedOut
      ? 'failed'
      : 'pending';

  // A buyer who just paid shouldn't come back to the store and still see
  // the lines they bought sitting in the cart — clear it once we can
  // confirm the order was actually provisioned.
  const matchedOrderId = matchedOrder?.id;
  useEffect(() => {
    if (matchedOrderId) {
      useCartStore.getState().clear();
    }
  }, [matchedOrderId]);

  useEffect(() => {
    if (status !== 'pending') return;
    const start = Date.now();
    const tick = setInterval(() => {
      refetch();
      if (Date.now() - start > POLL_TIMEOUT_MS) {
        setTimedOut(true);
        clearInterval(tick);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(tick);
  }, [status, refetch]);

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      {status === 'pending' && (
        <>
          <Spinner size="lg" />
          <h2 className="mt-6 text-xl font-semibold text-gray-900">
            {t('store.checkoutResult.confirmingTitle')}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {t('store.checkoutResult.confirmingBody')}
          </p>
        </>
      )}

      {status === 'success' && (
        <>
          <CheckCircle2 className="mx-auto h-14 w-14 text-green-500" aria-hidden="true" />
          <h2 className="mt-4 text-xl font-semibold text-gray-900">
            {t('store.checkoutResult.successTitle')}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {t('store.checkoutResult.successBody')}
          </p>
          <div className="mt-6 flex flex-col items-center gap-2">
            <Link
              to={`/admin/hardware-orders/${matchedOrder!.id}`}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              {t('store.checkoutResult.viewOrder')}
            </Link>
            <button
              type="button"
              onClick={onContinue}
              className="text-sm text-blue-600 hover:underline"
            >
              {t('store.checkoutResult.continueShopping')}
            </button>
          </div>
        </>
      )}

      {status === 'failed' && (
        <>
          <XCircle className="mx-auto h-14 w-14 text-red-500" aria-hidden="true" />
          <h2 className="mt-4 text-xl font-semibold text-gray-900">
            {t('store.checkoutResult.failTitle')}
          </h2>
          <p className="mt-2 text-sm text-gray-500">
            {t('store.checkoutResult.failBody')}
          </p>
          <button
            type="button"
            onClick={onContinue}
            className="mt-6 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            {t('store.checkoutResult.tryAgain')}
          </button>
        </>
      )}
    </div>
  );
}

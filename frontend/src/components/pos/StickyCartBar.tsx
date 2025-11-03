import { ShoppingCart } from 'lucide-react';
import Button from '../ui/Button';
import { formatCurrency } from '../../lib/utils';
import { useTranslation } from 'react-i18next';

interface StickyCartBarProps {
  itemCount: number;
  total: number;
  onViewCart: () => void;
  onCheckout: () => void;
  onCreateOrder: () => void;
  isCheckingOut?: boolean;
  hasItems: boolean;
  isTwoStepCheckout?: boolean;
  hasActiveOrder?: boolean;
}

const StickyCartBar = ({
  itemCount,
  total,
  onViewCart,
  onCheckout,
  onCreateOrder,
  isCheckingOut = false,
  hasItems,
  isTwoStepCheckout = false,
  hasActiveOrder = false,
}: StickyCartBarProps) => {
  const { t } = useTranslation('pos');
  if (!hasItems) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 lg:hidden">
      <div className="bg-white border-t border-gray-200 shadow-lg backdrop-blur-sm bg-opacity-95">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            {/* Cart Info */}
            <button
              onClick={onViewCart}
              className="flex items-center gap-3 flex-1 min-w-0 py-2 px-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            >
              <div className="relative">
                <ShoppingCart className="h-6 w-6 text-gray-700" />
                {itemCount > 0 && (
                  <span className="absolute -top-2 -right-2 bg-blue-600 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                    {itemCount > 99 ? '99+' : itemCount}
                  </span>
                )}
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-xs text-gray-500">
                  {itemCount} {itemCount === 1 ? t('stickyCart.item') : t('stickyCart.items')}
                </p>
                <p className="text-lg font-bold text-gray-900 truncate">
                  {formatCurrency(total)}
                </p>
              </div>
            </button>

            {/* Action Buttons - Conditional based on checkout mode */}
            {isTwoStepCheckout ? (
              <div className="flex gap-2">
                {/* Create/Update Order Button */}
                <Button
                  variant="primary"
                  size="lg"
                  onClick={onCreateOrder}
                  isLoading={isCheckingOut}
                  disabled={hasActiveOrder && itemCount === 0}
                  className="min-w-[100px] h-14 text-sm font-semibold"
                >
                  {hasActiveOrder ? t('stickyCart.update') : t('stickyCart.create')}
                </Button>

                {/* Payment Button */}
                <Button
                  variant="success"
                  size="lg"
                  onClick={onCheckout}
                  disabled={!hasActiveOrder}
                  className="min-w-[100px] h-14 text-sm font-semibold"
                >
                  {t('stickyCart.payment')}
                </Button>
              </div>
            ) : (
              /* Single-step Checkout Button */
              <Button
                variant="success"
                size="lg"
                onClick={onCheckout}
                isLoading={isCheckingOut}
                className="min-w-[120px] h-14 text-base font-semibold"
              >
                {t('checkout')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StickyCartBar;

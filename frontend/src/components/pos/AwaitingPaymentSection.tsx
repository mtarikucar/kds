import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, CreditCard, Clock } from 'lucide-react';
import { Order } from '../../types';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';

interface AwaitingPaymentSectionProps {
  orders: Order[];
  onCollectPayment: (orderId: string, amount: number) => void;
}

const AwaitingPaymentSection = ({
  orders,
  onCollectPayment,
}: AwaitingPaymentSectionProps) => {
  const { t } = useTranslation('pos');
  const formatPrice = useFormatCurrency();
  const [isExpanded, setIsExpanded] = useState(true);

  if (orders.length === 0) {
    return null;
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg mb-4">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-amber-100 transition-colors rounded-t-lg"
      >
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-amber-100 rounded-lg">
            <CreditCard className="h-4 w-4 text-amber-600" />
          </div>
          <span className="font-medium text-amber-800">
            {t('awaitingPayment.title')}
          </span>
          <span className="bg-amber-200 text-amber-800 text-xs font-medium px-2 py-0.5 rounded-full">
            {orders.length}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-amber-600" />
        ) : (
          <ChevronDown className="h-4 w-4 text-amber-600" />
        )}
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-amber-200 divide-y divide-amber-200">
          {orders.map((order) => {
            const itemCount =
              order.items?.length || order.orderItems?.length || 0;
            const itemsSummary =
              itemCount === 1
                ? `1 ${t('stickyCart.item')}`
                : `${itemCount} ${t('stickyCart.items')}`;

            return (
              <div
                key={order.id}
                className="p-3 flex items-center justify-between gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">
                      #{order.orderNumber}
                    </span>
                    <span className="text-xs text-slate-500 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(order.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <div className="text-sm text-slate-600 truncate">
                    {itemsSummary}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-xs text-slate-500">
                      {t('awaitingPayment.orderTotal')}
                    </div>
                    <div className="font-semibold text-slate-900">
                      {formatPrice(Number(order.finalAmount))}
                    </div>
                  </div>

                  <button
                    onClick={() =>
                      onCollectPayment(order.id, Number(order.finalAmount))
                    }
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                  >
                    {t('awaitingPayment.collectPayment')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AwaitingPaymentSection;

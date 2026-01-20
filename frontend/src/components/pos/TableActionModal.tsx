import { useTranslation } from 'react-i18next';
import { Table, Order } from '../../types';
import { useOrders } from '../../features/orders/ordersApi';
import { OrderStatus } from '../../types';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { ShoppingCart, Receipt, Plus, X } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import { useCurrency } from '../../hooks/useCurrency';
import Badge from '../ui/Badge';
import Spinner from '../ui/Spinner';
import { cn } from '../../lib/utils';

interface TableActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  table: Table;
  onAddOrder: () => void;
  onCloseBill: () => void;
}

const TableActionModal = ({
  isOpen,
  onClose,
  table,
  onAddOrder,
  onCloseBill,
}: TableActionModalProps) => {
  const { t } = useTranslation('pos');
  const currency = useCurrency();

  // Fetch active orders for the table
  const { data: orders, isLoading } = useOrders({
    tableId: table.id,
    status: [
      OrderStatus.PENDING,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      OrderStatus.SERVED,
    ].join(','),
  });

  const activeOrders = orders || [];
  const totalAmount = activeOrders.reduce(
    (sum, order) => sum + Number(order.finalAmount || 0),
    0
  );

  const getStatusVariant = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.PENDING:
        return 'warning';
      case OrderStatus.PREPARING:
        return 'primary';
      case OrderStatus.READY:
        return 'success';
      case OrderStatus.SERVED:
        return 'default';
      default:
        return 'danger';
    }
  };

  const handleAddOrder = () => {
    // onAddOrder çağrıldığında parent component modal'ı kapatacak
    // ve selectedTable'ı koruyacak
    onAddOrder();
  };

  const handleCloseBill = () => {
    onCloseBill();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${t('tableLabel')} ${table.number} - ${t('tableActions', 'Masa İşlemleri')}`}
      size="md"
    >
      <div className="space-y-6">
        {/* Table Info */}
        <div className="p-4 bg-neutral-50 rounded-lg border border-border">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-muted-foreground">
              {t('tableStatus', 'Masa Durumu')}
            </span>
            <Badge variant="danger">{t('tableGrid.status.OCCUPIED')}</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              {t('totalAmount', 'Toplam Tutar')}
            </span>
            <span className="text-lg font-bold text-foreground">
              {formatCurrency(totalAmount, currency)}
            </span>
          </div>
        </div>

        {/* Active Orders */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : activeOrders.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-3">
              {t('activeOrders', 'Aktif Siparişler')} ({activeOrders.length})
            </h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {activeOrders.map((order) => (
                <div
                  key={order.id}
                  className="p-3 bg-card border border-border rounded-lg hover:bg-neutral-50 transition-colors duration-150"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">
                        #{order.orderNumber}
                      </span>
                      <Badge variant={getStatusVariant(order.status)}>
                        {order.status}
                      </Badge>
                    </div>
                    <span className="font-bold text-foreground">
                      {formatCurrency(Number(order.finalAmount), currency)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {order.items?.length || order.orderItems?.length || 0}{' '}
                    {t('items', 'ürün')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            <p>{t('noActiveOrders', 'Aktif sipariş bulunmuyor')}</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-border">
          <Button
            variant="primary"
            size="lg"
            onClick={handleAddOrder}
            icon={Plus}
            className="flex-1"
          >
            {t('addNewOrder', 'Yeni Sipariş Ekle')}
          </Button>
          <Button
            variant="success"
            size="lg"
            onClick={handleCloseBill}
            icon={Receipt}
            className="flex-1"
            disabled={activeOrders.length === 0}
          >
            {t('closeBill', 'Hesap Kapat')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default TableActionModal;

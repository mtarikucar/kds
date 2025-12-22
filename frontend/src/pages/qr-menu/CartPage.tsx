import { useState } from 'react';
import QRMenuLayout, { MenuData } from './QRMenuLayout';
import CartContent from '../../components/qr-menu/CartContent';
import TableSelectionModal from '../../components/qr-menu/TableSelectionModal';
import { useCartStore } from '../../store/cartStore';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { toast } from 'sonner';

const CartPage = () => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { tenantId } = useParams<{ tenantId: string }>();
  const [searchParams] = useSearchParams();
  const tableId = searchParams.get('tableId');

  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [isShowingTableSelection, setIsShowingTableSelection] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { items, sessionId, tableId: cartTableId, clearCart } = useCartStore();

  const handleSubmitOrder = async () => {
    if (!sessionId) {
      toast.error(t('cart.sessionExpired'));
      return;
    }

    if (!tableId && !menuData?.enableTablelessMode) {
      setIsShowingTableSelection(true);
      return;
    }

    setIsSubmitting(true);
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      const orderUrl = API_URL + '/customer-orders';

      await axios.post(orderUrl, {
        tenantId,
        tableId: tableId || undefined,
        sessionId,
        items: items.map(item => ({
          productId: item.product.id,
          quantity: item.quantity,
          modifiers: item.modifiers,
          notes: item.notes,
        })),
      });

      toast.success(t('cart.orderSubmitted'));
      clearCart();
      
      const ordersUrl = '/qr-menu/' + tenantId + '/orders' + (tableId ? '?tableId=' + tableId : '');
      navigate(ordersUrl);
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('messages.operationFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <QRMenuLayout currentPage='cart' onMenuDataLoaded={setMenuData}>
      {menuData && (
        <>
          <CartContent
            settings={menuData.settings}
            enableCustomerOrdering={menuData.enableCustomerOrdering}
            currency={menuData.tenant.currency || 'TRY'}
            onSubmitOrder={handleSubmitOrder}
            onShowTableSelection={() => setIsShowingTableSelection(true)}
            isSubmitting={isSubmitting}
          />
          {isShowingTableSelection && (
            <TableSelectionModal
              isOpen={isShowingTableSelection}
              onClose={() => setIsShowingTableSelection(false)}
              onSelectTable={() => {
                setIsShowingTableSelection(false);
                handleSubmitOrder();
              }}
              primaryColor={menuData.settings.primaryColor}
            />
          )}
        </>
      )}
    </QRMenuLayout>
  );
};

export default CartPage;

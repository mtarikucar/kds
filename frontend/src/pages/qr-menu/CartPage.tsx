import { useState, useEffect } from 'react';
import QRMenuLayout, { MenuData } from './QRMenuLayout';
import CartContent from '../../components/qr-menu/CartContent';
import TableSelectionModal from '../../components/qr-menu/TableSelectionModal';
import { useCartStore } from '../../store/cartStore';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { toast } from 'sonner';
import { useGeolocation } from '../../hooks';

const CartPage = () => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { tenantId } = useParams<{ tenantId: string }>();
  const [searchParams] = useSearchParams();
  const tableId = searchParams.get('tableId');

  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [isShowingTableSelection, setIsShowingTableSelection] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [locationRequested, setLocationRequested] = useState(false);

  const { items, sessionId, tableId: cartTableId, clearCart } = useCartStore();
  const {
    latitude,
    longitude,
    error: locationError,
    loading: locationLoading,
    getCurrentPosition,
    permissionStatus
  } = useGeolocation();

  // Request location when page loads
  useEffect(() => {
    if (!locationRequested) {
      setLocationRequested(true);
      getCurrentPosition();
    }
  }, [locationRequested, getCurrentPosition]);

  const handleSubmitOrder = async () => {
    // Prevent double submission
    if (isSubmitting) return;

    if (!sessionId) {
      toast.error(t('cart.sessionExpired'));
      return;
    }

    if (!tableId && !menuData?.enableTablelessMode) {
      setIsShowingTableSelection(true);
      return;
    }

    // Try to get location if not already available
    let orderLat = latitude;
    let orderLng = longitude;

    if (!orderLat || !orderLng) {
      const position = await getCurrentPosition();
      if (position) {
        orderLat = position.latitude;
        orderLng = position.longitude;
      }
    }

    setIsSubmitting(true);
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      const orderUrl = API_URL + '/customer-orders';

      await axios.post(orderUrl, {
        tenantId,
        tableId: tableId || undefined,
        sessionId,
        latitude: orderLat || undefined,
        longitude: orderLng || undefined,
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
            tenantId={tenantId}
            tableId={tableId}
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

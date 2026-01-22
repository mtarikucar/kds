import { useState, useEffect } from 'react';
import QRMenuLayout, { MenuData } from './QRMenuLayout';
import CartContent from '../../components/qr-menu/CartContent';
import TableSelectionModal from '../../components/qr-menu/TableSelectionModal';
import { useCartStore } from '../../store/cartStore';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { toast } from 'sonner';
import { useGeolocation } from '../../hooks';
import { buildQRMenuUrl } from '../../utils/subdomain';

interface SubdomainCartPageProps {
  subdomain: string;
}

const SubdomainCartPage: React.FC<SubdomainCartPageProps> = ({ subdomain }) => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tableId = searchParams.get('tableId');

  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [isShowingTableSelection, setIsShowingTableSelection] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [locationRequested, setLocationRequested] = useState(false);

  const { items, sessionId, clearCart } = useCartStore();
  const {
    latitude,
    longitude,
    getCurrentPosition,
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

    if (!sessionId || !menuData) {
      toast.error(t('cart.sessionExpired'));
      return;
    }

    const tenantId = menuData.tenant.id;

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

      const ordersUrl = buildQRMenuUrl('orders', { subdomain, tableId, sessionId });
      navigate(ordersUrl);
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('messages.operationFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <QRMenuLayout currentPage='cart' onMenuDataLoaded={setMenuData} subdomain={subdomain}>
      {menuData && (
        <>
          <CartContent
            settings={menuData.settings}
            enableCustomerOrdering={menuData.enableCustomerOrdering}
            currency={menuData.tenant.currency || 'TRY'}
            onSubmitOrder={handleSubmitOrder}
            onShowTableSelection={() => setIsShowingTableSelection(true)}
            isSubmitting={isSubmitting}
            tenantId={menuData.tenant.id}
            tableId={tableId}
            subdomain={subdomain}
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

export default SubdomainCartPage;

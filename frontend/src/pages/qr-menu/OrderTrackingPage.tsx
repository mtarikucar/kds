import { useState, useEffect } from 'react';
import QRMenuLayout, { MenuData } from './QRMenuLayout';
import OrdersContent from '../../components/qr-menu/OrdersContent';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { toast } from 'sonner';
import { Order } from '../../types';

const OrderTrackingPage = () => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { tenantId } = useParams<{ tenantId: string }>();
  const [searchParams] = useSearchParams();
  const tableId = searchParams.get('tableId');

  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const fetchOrders = async () => {
      if (!sessionId || !tenantId) return;

      try {
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
        const response = await axios.get(`${API_URL}/customer-orders/session/${sessionId}?tenantId=${tenantId}`);
        setOrders(response.data);
      } catch (error) {
        console.error('Error fetching orders:', error);
      }
    };

    const interval = setInterval(fetchOrders, 3000);
    fetchOrders();

    return () => clearInterval(interval);
  }, [sessionId, tenantId]);

  const handleCallWaiter = async () => {
    if (!sessionId || !tenantId || !tableId) {
      toast.error(t('messages.operationFailed'));
      return;
    }

    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      await axios.post(`${API_URL}/customer-orders/waiter-requests`, {
        tenantId,
        tableId,
        sessionId,
      });
      toast.success(t('waiter.callSuccess'));
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('waiter.callError'));
    }
  };

  const handleRequestBill = async () => {
    if (!sessionId || !tenantId || !tableId) {
      toast.error(t('messages.operationFailed'));
      return;
    }

    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      await axios.post(`${API_URL}/customer-orders/bill-requests`, {
        tenantId,
        tableId,
        sessionId,
      });
      toast.success(t('bill.requestSuccess'));
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('bill.requestError'));
    }
  };

  const handleBrowseMenu = () => {
    const url = tableId ? `/qr-menu/${tenantId}?tableId=${tableId}` : `/qr-menu/${tenantId}`;
    navigate(url);
  };

  return (
    <QRMenuLayout currentPage="orders" onMenuDataLoaded={setMenuData} onSessionIdChange={setSessionId}>
      {menuData && (
        <OrdersContent
          orders={orders}
          settings={menuData.settings}
          tenantId={tenantId}
          tableId={tableId}
          onCallWaiter={handleCallWaiter}
          onRequestBill={handleRequestBill}
          onBrowseMenu={handleBrowseMenu}
        />
      )}
    </QRMenuLayout>
  );
};

export default OrderTrackingPage;


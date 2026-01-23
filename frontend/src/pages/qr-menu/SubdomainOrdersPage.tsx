import { useState, useEffect } from 'react';
import QRMenuLayout, { MenuData } from './QRMenuLayout';
import OrdersContent from '../../components/qr-menu/OrdersContent';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { toast } from 'sonner';
import { Order } from '../../types';
import { buildQRMenuUrl } from '../../utils/subdomain';

interface SubdomainOrdersPageProps {
  subdomain: string;
}

const SubdomainOrdersPage: React.FC<SubdomainOrdersPageProps> = ({ subdomain }) => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const tableId = searchParams.get('tableId');

  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const fetchOrders = async () => {
      if (!sessionId || !menuData) return;

      const tenantId = menuData.tenant.id;

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
  }, [sessionId, menuData]);

  const handleCallWaiter = async () => {
    if (!sessionId || !menuData || !tableId) {
      toast.error(t('messages.operationFailed'));
      return;
    }

    const tenantId = menuData.tenant.id;

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
    if (!sessionId || !menuData) {
      toast.error(t('messages.operationFailed'));
      return;
    }

    const tenantId = menuData.tenant.id;

    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
      await axios.post(`${API_URL}/customer-orders/bill-requests`, {
        tenantId,
        tableId: tableId || null,
        sessionId,
      });
      toast.success(t('bill.requestSuccess'));
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('bill.requestError'));
    }
  };

  const handleBrowseMenu = () => {
    const url = buildQRMenuUrl('menu', { subdomain, tableId });
    navigate(url);
  };

  return (
    <QRMenuLayout currentPage="orders" onMenuDataLoaded={setMenuData} onSessionIdChange={setSessionId} subdomain={subdomain}>
      {menuData && (
        <OrdersContent
          orders={orders}
          settings={menuData.settings}
          tenantId={menuData.tenant.id}
          tableId={tableId}
          onCallWaiter={handleCallWaiter}
          onRequestBill={handleRequestBill}
          onBrowseMenu={handleBrowseMenu}
        />
      )}
    </QRMenuLayout>
  );
};

export default SubdomainOrdersPage;

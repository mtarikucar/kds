import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import QRMenuLayout, { MenuData } from './QRMenuLayout';
import LoyaltyContent from '../../components/qr-menu/LoyaltyContent';
import axios from 'axios';

interface Transaction {
  id: string;
  type: string;
  points: number;
  description: string;
  createdAt: string;
}

const LoyaltyPage = () => {
  const { t } = useTranslation('common');
  const [menuData, setMenuData] = useState<MenuData | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showTransactions, setShowTransactions] = useState(false);

  useEffect(() => {
    const fetchTransactions = async () => {
      if (!sessionId) return;

      try {
        const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
        const response = await axios.get(
          `${API_URL}/customer-public/sessions/${sessionId}/loyalty/transactions`
        );
        setTransactions(response.data);
      } catch (error) {
        console.error('Error fetching transactions:', error);
      }
    };

    fetchTransactions();
  }, [sessionId]);

  return (
    <QRMenuLayout currentPage="loyalty" onMenuDataLoaded={setMenuData} onSessionIdChange={setSessionId}>
      {menuData && (
        <LoyaltyContent
          settings={menuData.settings}
          sessionId={sessionId}
          tenantId={menuData.tenant.id}
          transactions={transactions}
          showTransactions={showTransactions}
          onToggleTransactions={() => setShowTransactions(!showTransactions)}
        />
      )}
    </QRMenuLayout>
  );
};

export default LoyaltyPage;


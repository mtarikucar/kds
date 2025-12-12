import { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Gift, History } from 'lucide-react';
import axios from 'axios';
import Spinner from '../../components/ui/Spinner';
import LoyaltyDisplay from '../../components/qr-menu/LoyaltyDisplay';
import MobileBottomMenu from '../../components/qr-menu/MobileBottomMenu';
import { toast } from 'sonner';

interface MenuSettings {
  primaryColor: string;
  secondaryColor: string;
}

interface Transaction {
  id: string;
  type: string;
  points: number;
  description: string;
  createdAt: string;
}

const LoyaltyPage = () => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { tenantId } = useParams<{ tenantId: string }>();
  const [searchParams] = useSearchParams();
  const tableId = searchParams.get('tableId');
  const sessionId = searchParams.get('sessionId');

  const [isLoading, setIsLoading] = useState(true);
  const [settings, setSettings] = useState<MenuSettings>({
    primaryColor: '#FF6B6B',
    secondaryColor: '#4ECDC4',
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [showTransactions, setShowTransactions] = useState(false);
  const [referralCode, setReferralCode] = useState('');
  const [isApplyingReferral, setIsApplyingReferral] = useState(false);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

  useEffect(() => {
    fetchData();
  }, [tenantId, sessionId]);

  const fetchData = async () => {
    if (!tenantId || !sessionId) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);

      // Fetch menu settings
      const settingsRes = await axios.get(`${API_URL}/qr-menu/${tenantId}`);
      setSettings({
        primaryColor: settingsRes.data.settings.primaryColor,
        secondaryColor: settingsRes.data.settings.secondaryColor,
      });

      // Fetch transaction history
      try {
        const transactionsRes = await axios.get(
          `${API_URL}/customer-public/loyalty/transactions?sessionId=${sessionId}&limit=20`
        );
        setTransactions(transactionsRes.data);
      } catch (err) {
        console.log('No transaction history available');
      }
    } catch (error) {
      console.error('Failed to fetch data:', error);
      toast.error(t('loyalty.error'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyReferralCode = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!referralCode || referralCode.length < 4) {
      toast.error(t('loyalty.invalidReferralCode'));
      return;
    }

    setIsApplyingReferral(true);
    try {
      // First, get customer ID from session
      const sessionRes = await axios.get(`${API_URL}/customer-public/sessions/${sessionId}`);
      const customerId = sessionRes.data.customerId;

      if (!customerId) {
        toast.error(t('loyalty.mustIdentify'));
        return;
      }

      // Apply referral code
      await axios.post(`${API_URL}/customer-public/referral/apply`, {
        customerId,
        referralCode: referralCode.toUpperCase(),
        tenantId,
      });

      toast.success(t('loyalty.referralApplied'));
      setReferralCode('');
      // Refresh data
      fetchData();
    } catch (error: any) {
      console.error('Failed to apply referral code:', error);
      toast.error(
        error.response?.data?.message ||
        t('loyalty.referralFailed')
      );
    } finally {
      setIsApplyingReferral(false);
    }
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'EARNED':
        return '📈';
      case 'REDEEMED':
        return '🎁';
      case 'BONUS':
        return '🎉';
      case 'REFERRAL':
        return '👥';
      default:
        return '💰';
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 animate-in fade-in duration-300">
      {/* Header */}
      <div
        className="fixed top-0 left-0 right-0 z-20 shadow-2xl"
        style={{
          background: `linear-gradient(135deg, ${settings.primaryColor} 0%, ${settings.secondaryColor} 100%)`,
        }}
      >
        <div className="px-4 py-5 flex items-center gap-4">
          <button
            onClick={() => navigate(`/qr-menu/${tenantId}${tableId ? `?tableId=${tableId}` : ''}`)}
            className="p-2.5 rounded-full bg-white/20 hover:bg-white/30 transition-all duration-200 transform hover:scale-110 active:scale-95"
          >
            <ArrowLeft className="h-5 w-5 text-white" />
          </button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">
              {t('loyalty.title')}
            </h1>
            <p className="text-white/80 text-sm mt-0.5">
              {t('loyalty.subtitle')}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 pt-28 pb-40">
        {/* Loyalty Display Component */}
        {sessionId && (
          <LoyaltyDisplay
            sessionId={sessionId}
            tenantId={tenantId || ''}
            primaryColor={settings.primaryColor}
            secondaryColor={settings.secondaryColor}
          />
        )}

        {/* Apply Referral Code Card */}
        <div className="bg-white rounded-2xl shadow-md p-6 mt-4 animate-in fade-in slide-in-from-bottom delay-300">
          <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
            <Gift className="h-5 w-5" style={{ color: settings.primaryColor }} />
            {t('loyalty.haveReferralCode')}
          </h3>
          <form onSubmit={handleApplyReferralCode} className="flex gap-2">
            <input
              type="text"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
              placeholder={t('loyalty.enterCode')}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-opacity-50 uppercase"
              disabled={isApplyingReferral}
              maxLength={12}
            />
            <button
              type="submit"
              disabled={isApplyingReferral}
              className="px-6 py-2 rounded-lg font-semibold text-white transition-all duration-200 transform hover:scale-105 active:scale-95"
              style={{ backgroundColor: settings.primaryColor }}
            >
              {isApplyingReferral ? t('loyalty.applying') : t('loyalty.apply')}
            </button>
          </form>
        </div>

        {/* Transaction History */}
        {transactions.length > 0 && (
          <div className="bg-white rounded-2xl shadow-md p-6 mt-4 animate-in fade-in slide-in-from-bottom delay-400">
            <button
              onClick={() => setShowTransactions(!showTransactions)}
              className="w-full flex items-center justify-between mb-4"
            >
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <History className="h-5 w-5" style={{ color: settings.secondaryColor }} />
                {t('loyalty.transactionHistory')}
              </h3>
              <span className="text-gray-500">
                {showTransactions ? '▲' : '▼'}
              </span>
            </button>

            {showTransactions && (
              <div className="space-y-2">
                {transactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">
                        {getTransactionIcon(transaction.type)}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {transaction.description}
                        </p>
                        <p className="text-xs text-gray-500">
                          {new Date(transaction.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-lg font-bold ${transaction.points > 0 ? 'text-green-600' : 'text-red-600'
                        }`}
                    >
                      {transaction.points > 0 ? '+' : ''}
                      {transaction.points}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile Bottom Menu */}
      <MobileBottomMenu
        tenantId={tenantId}
        tableId={tableId}
        primaryColor={settings.primaryColor}
        secondaryColor={settings.secondaryColor}
        currentPage="loyalty"
      />
    </div>
  );
};

export default LoyaltyPage;

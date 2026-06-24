import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Gift, History } from 'lucide-react';
import { toast } from 'sonner';
import axios from 'axios';
import LoyaltyDisplay from './LoyaltyDisplay';
import { MenuSettings } from '../../pages/qr-menu/QRMenuLayout';

interface Transaction {
  id: string;
  type: string;
  points: number;
  description: string;
  createdAt: string;
}

interface LoyaltyContentProps {
  settings: MenuSettings;
  sessionId: string | null;
  tenantId: string | undefined;
  transactions: Transaction[];
  showTransactions: boolean;
  onToggleTransactions: () => void;
}

const LoyaltyContent: React.FC<LoyaltyContentProps> = ({
  settings,
  sessionId,
  tenantId,
  transactions,
  showTransactions,
  onToggleTransactions,
}) => {
  const { t } = useTranslation('common');
  const [referralCode, setReferralCode] = useState('');
  const [isApplyingReferral, setIsApplyingReferral] = useState(false);

  const handleApplyReferralCode = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!referralCode || referralCode.length < 4) {
      toast.error(t('loyalty.invalidReferralCode'));
      return;
    }

    if (!sessionId) {
      toast.error(t('loyalty.mustIdentify'));
      return;
    }

    setIsApplyingReferral(true);
    try {
      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

      // The backend resolves the customerId from the server-side session
      // (POST /customer-public/referral/apply takes { sessionId, referralCode }),
      // so no separate session lookup is needed. The endpoint additionally
      // requires the customer's phone to be verified; if it is not, the API
      // returns a 403 whose message we surface verbatim so the customer knows
      // to verify their phone first.
      await axios.post(`${API_URL}/customer-public/referral/apply`, {
        sessionId,
        referralCode: referralCode.toUpperCase(),
      });

      toast.success(t('loyalty.referralApplied'));
      setReferralCode('');
    } catch (error: any) {
      toast.error(error.response?.data?.message || t('loyalty.referralFailed'));
    } finally {
      setIsApplyingReferral(false);
    }
  };

  const getTransactionEmoji = (type: string) => {
    switch (type) {
      case 'PURCHASE':
        return '🛍️';
      case 'REWARD':
        return '🎁';
      case 'REFERRAL':
        return '👥';
      default:
        return '💰';
    }
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 mb-20 md:mb-0">
      <div className="max-w-2xl mx-auto">
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
        <div className="bg-white rounded-2xl shadow-md p-4 sm:p-6 mt-4 animate-in fade-in slide-in-from-bottom delay-300">
          <h3 className="text-base sm:text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Gift className="h-5 w-5 flex-shrink-0" style={{ color: settings.primaryColor }} />
            <span className="truncate">{t('loyalty.haveReferralCode')}</span>
          </h3>
          <form onSubmit={handleApplyReferralCode} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={referralCode}
              onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
              placeholder={t('loyalty.enterCode')}
              className="flex-1 px-3 sm:px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-opacity-50 uppercase text-sm sm:text-base"
              style={{ ['--tw-ring-color' as any]: settings.primaryColor }}
              disabled={isApplyingReferral}
              maxLength={12}
            />
            <button
              type="submit"
              disabled={isApplyingReferral}
              className="px-4 sm:px-6 py-2 rounded-lg font-semibold text-white transition-all duration-200 transform hover:scale-105 active:scale-95 disabled:opacity-50 whitespace-nowrap text-sm sm:text-base"
              style={{ backgroundColor: settings.primaryColor }}
            >
              {isApplyingReferral ? t('common.loading', 'Loading...') : t('common.apply', 'Apply')}
            </button>
          </form>
        </div>

        {/* Transaction History */}
        {transactions.length > 0 && (
          <div className="mt-6">
            <button
              onClick={onToggleTransactions}
              className="w-full flex items-center justify-between p-4 bg-white rounded-2xl shadow-md hover:shadow-lg transition-all duration-200"
            >
              <div className="flex items-center gap-2">
                <History className="h-5 w-5" style={{ color: settings.primaryColor }} />
                <span className="font-semibold text-slate-900">
                  {t('loyalty.transactionHistory', 'Transaction History')}
                </span>
              </div>
              <span className="text-slate-500">{showTransactions ? '▼' : '▶'}</span>
            </button>

            {showTransactions && (
              <div className="mt-4 space-y-2">
                {transactions.map((transaction) => (
                  <div
                    key={transaction.id}
                    className="bg-white rounded-lg p-4 flex items-center justify-between border-l-4 rtl:border-l-0 rtl:border-r-4"
                    style={{ borderLeftColor: settings.primaryColor, borderRightColor: settings.primaryColor }}
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <span className="text-2xl">
                        {getTransactionEmoji(transaction.type)}
                      </span>
                      <div className="flex-1">
                        <p className="font-medium text-slate-900">
                          {transaction.description}
                        </p>
                        <p className="text-xs text-slate-500">
                          {new Date(transaction.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <span
                      className="font-bold text-lg"
                      style={{
                        color: transaction.points > 0 ? '#10b981' : '#ef4444',
                      }}
                    >
                      {transaction.points > 0 ? '+' : ''}{transaction.points}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default LoyaltyContent;


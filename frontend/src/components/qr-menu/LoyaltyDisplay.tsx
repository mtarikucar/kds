import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import {
  Award,
  Gift,
  TrendingUp,
  Users,
  Copy,
  CheckCircle2,
  Trophy,
  Star,
} from 'lucide-react';
import { toast } from 'sonner';
import Spinner from '../ui/Spinner';

interface LoyaltyDisplayProps {
  sessionId: string;
  tenantId: string;
  primaryColor?: string;
  secondaryColor?: string;
}

const LoyaltyDisplay = ({
  sessionId,
  tenantId,
  primaryColor = '#FF6B6B',
  secondaryColor = '#4ECDC4',
}: LoyaltyDisplayProps) => {
  const { t } = useTranslation('common');
  const [isLoading, setIsLoading] = useState(true);
  const [loyaltyData, setLoyaltyData] = useState<any>(null);
  const [tierData, setTierData] = useState<any>(null);
  const [referralData, setReferralData] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

  useEffect(() => {
    fetchLoyaltyData();
  }, [sessionId]);

  const fetchLoyaltyData = async () => {
    try {
      setIsLoading(true);

      // Fetch loyalty balance
      const balanceRes = await axios.get(
        `${API_URL}/customer-public/loyalty/balance?sessionId=${sessionId}`
      );
      setLoyaltyData(balanceRes.data);

      // Fetch tier status
      const tierRes = await axios.get(
        `${API_URL}/customer-public/loyalty/tier?sessionId=${sessionId}`
      );
      setTierData(tierRes.data);

      // Fetch referral stats
      const referralRes = await axios.get(
        `${API_URL}/customer-public/referral/stats?sessionId=${sessionId}`
      );
      setReferralData(referralRes.data);
    } catch (error) {
      console.error('Failed to fetch loyalty data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const copyReferralCode = () => {
    if (referralData?.referralCode) {
      navigator.clipboard.writeText(referralData.referralCode);
      setCopied(true);
      toast.success(t('loyalty.codeCopied'));
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getTierIcon = (tier: string) => {
    switch (tier) {
      case 'PLATINUM':
        return <Trophy className="h-6 w-6 text-purple-500" />;
      case 'GOLD':
        return <Award className="h-6 w-6 text-yellow-500" />;
      case 'SILVER':
        return <Star className="h-6 w-6 text-gray-400" />;
      default:
        return <Award className="h-6 w-6 text-amber-700" />;
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'PLATINUM':
        return 'from-purple-500 to-purple-700';
      case 'GOLD':
        return 'from-yellow-400 to-yellow-600';
      case 'SILVER':
        return 'from-gray-300 to-gray-500';
      default:
        return 'from-amber-700 to-amber-900';
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center py-8">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!loyaltyData?.identified) {
    return (
      <div className="bg-white rounded-2xl shadow-md p-6 text-center">
        <Gift className="h-12 w-12 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-600">
          {t('loyalty.notIdentified')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Loyalty Points Card */}
      <div
        className="rounded-2xl shadow-lg p-6 text-white animate-in fade-in slide-in-from-bottom"
        style={{
          background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center">
              <Award className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-white/80 text-sm">
                {t('loyalty.yourPoints')}
              </p>
              <p className="text-3xl font-bold">{loyaltyData.points || 0}</p>
            </div>
          </div>
          {tierData && getTierIcon(tierData.currentTier)}
        </div>

        <div className="bg-white/20 rounded-lg p-3">
          <div className="flex justify-between items-center mb-1">
            <span className="text-white/90 text-sm">
              {t('loyalty.redeemable')}
            </span>
            <span className="text-lg font-bold">
              ${loyaltyData.redeemableAmount?.toFixed(2) || '0.00'}
            </span>
          </div>
          {loyaltyData.canRedeem ? (
            <p className="text-white/70 text-xs">
              {t('loyalty.canRedeem')}
            </p>
          ) : (
            <p className="text-white/70 text-xs">
              {t('loyalty.minimumPoints', { min: loyaltyData.minRedeemPoints })}
            </p>
          )}
        </div>
      </div>

      {/* Tier Progress Card */}
      {tierData && (
        <div className="bg-white rounded-2xl shadow-md p-6 animate-in fade-in slide-in-from-bottom delay-100">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                {t('loyalty.tierStatus')}
              </h3>
              <p className="text-sm text-gray-600">
                {tierData.currentTierInfo?.name} {t('loyalty.member')}
              </p>
            </div>
            <div
              className={`w-16 h-16 rounded-full flex items-center justify-center bg-gradient-to-br ${getTierColor(
                tierData.currentTier
              )}`}
            >
              {getTierIcon(tierData.currentTier)}
            </div>
          </div>

          {tierData.nextTier && (
            <>
              <div className="mb-2">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">
                    {t('loyalty.progressToNextTier', { tier: tierData.nextTierInfo?.name })}
                  </span>
                  <span className="font-semibold" style={{ color: primaryColor }}>
                    {Math.round(tierData.progressPercentage)}%
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${tierData.progressPercentage}%`,
                      backgroundColor: primaryColor,
                    }}
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                {t('loyalty.pointsToNextTier', { points: tierData.pointsToNextTier, tier: tierData.nextTierInfo?.name })}
              </p>
            </>
          )}

          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <TrendingUp className="h-4 w-4" />
              <span>
                {t('loyalty.lifetimePoints', { points: tierData.lifetimePoints })}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Referral Card */}
      {referralData && (
        <div className="bg-white rounded-2xl shadow-md p-6 animate-in fade-in slide-in-from-bottom delay-200">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ backgroundColor: `${secondaryColor}15` }}
            >
              <Users className="h-6 w-6" style={{ color: secondaryColor }} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900">
                {t('loyalty.referralProgram')}
              </h3>
              <p className="text-sm text-gray-600">
                {t('loyalty.shareAndEarn')}
              </p>
            </div>
          </div>

          {referralData.referralCode ? (
            <>
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <p className="text-xs text-gray-600 mb-2">
                  {t('loyalty.yourReferralCode')}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-2xl font-bold tracking-wider text-center py-2 bg-white rounded border-2 border-gray-300">
                    {referralData.referralCode}
                  </code>
                  <button
                    onClick={copyReferralCode}
                    className="p-3 rounded-lg transition-all duration-200 transform hover:scale-110 active:scale-95"
                    style={{ backgroundColor: `${secondaryColor}15`, color: secondaryColor }}
                  >
                    {copied ? (
                      <CheckCircle2 className="h-6 w-6" />
                    ) : (
                      <Copy className="h-6 w-6" />
                    )}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold" style={{ color: secondaryColor }}>
                    {referralData.totalReferrals || 0}
                  </p>
                  <p className="text-xs text-gray-600">
                    {t('loyalty.referrals')}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold" style={{ color: secondaryColor }}>
                    {referralData.totalPointsEarned || 0}
                  </p>
                  <p className="text-xs text-gray-600">
                    {t('loyalty.pointsEarned')}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-600 text-center py-4">
              {t('loyalty.noReferralCode')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default LoyaltyDisplay;

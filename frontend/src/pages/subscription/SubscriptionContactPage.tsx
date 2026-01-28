import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, CheckCircle2, MessageCircle, Mail, Phone, ExternalLink } from 'lucide-react';
import {
  useGetContactLinks,
  useGetUpgradeContactLinks,
} from '../../api/contactApi';

export default function SubscriptionContactPage() {
  const { t } = useTranslation('subscriptions');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const planId = searchParams.get('planId');
  const billingCycle = searchParams.get('billingCycle');
  // Upgrade parameters
  const type = searchParams.get('type');
  const subscriptionId = searchParams.get('subscriptionId');
  const newPlanId = searchParams.get('newPlanId');

  const [contactData, setContactData] = useState<{
    planName: string;
    billingCycle: string;
    amount: number;
    currency: string;
    whatsappLink: string;
    emailLink: string;
    whatsappNumber: string;
    email: string;
    currentPlanName?: string;
    newPlanName?: string;
  } | null>(null);
  const [contacted, setContacted] = useState(false);

  const getContactLinks = useGetContactLinks();
  const getUpgradeContactLinks = useGetUpgradeContactLinks();

  // Fetch contact links on mount
  useEffect(() => {
    if (type === 'upgrade' && subscriptionId && newPlanId && billingCycle) {
      // Handle upgrade inquiry
      getUpgradeContactLinks.mutate(
        {
          subscriptionId,
          newPlanId,
          billingCycle: billingCycle as 'MONTHLY' | 'YEARLY',
        },
        {
          onSuccess: (data) => {
            setContactData(data);
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.message || t('subscriptions.contact.error', 'Bir hata olustu'));
            navigate('/admin/settings/subscription');
          },
        }
      );
    } else if (planId && billingCycle) {
      // Handle new subscription inquiry
      getContactLinks.mutate(
        { planId, billingCycle: billingCycle as 'MONTHLY' | 'YEARLY' },
        {
          onSuccess: (data) => {
            setContactData(data);
          },
          onError: (error: any) => {
            toast.error(error.response?.data?.message || t('subscriptions.contact.error', 'Bir hata olustu'));
            navigate('/subscription/plans');
          },
        }
      );
    } else {
      toast.error(t('subscriptions.contact.missingInfo', 'Eksik bilgi'));
      navigate('/subscription/plans');
    }
  }, [planId, billingCycle, type, subscriptionId, newPlanId]);

  const formatCurrency = (amount: number, currency: string) => {
    if (currency === 'TRY' || currency === 'TL') {
      return `${amount.toFixed(2)} TL`;
    }
    return `${amount.toFixed(2)} ${currency}`;
  };

  const handleWhatsAppClick = () => {
    if (contactData) {
      window.open(contactData.whatsappLink, '_blank');
      setContacted(true);
    }
  };

  const handleEmailClick = () => {
    if (contactData) {
      window.location.href = contactData.emailLink;
      setContacted(true);
    }
  };

  if (getContactLinks.isPending || getUpgradeContactLinks.isPending) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mx-auto mb-4" />
          <p className="text-slate-600">{t('subscriptions.contact.loading', 'Yukleniyor...')}</p>
        </div>
      </div>
    );
  }

  // Show thank you message after contact
  if (contacted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="w-12 h-12 text-green-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            {t('subscriptions.contact.thankYou', 'Tesekkurler!')}
          </h2>
          <p className="text-slate-600 mb-6">
            {t('subscriptions.contact.thankYouMessage', 'Talebiniz alindi. En kisa surede sizinle iletisime gecilebilir.')}
          </p>
          <div className="space-y-3">
            <button
              onClick={() => navigate('/admin/settings/subscription')}
              className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              {t('subscriptions.payment.goToSubscription')}
            </button>
            <button
              onClick={() => setContacted(false)}
              className="w-full px-6 py-3 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
            >
              {t('subscriptions.contact.backToContact', 'Iletisime Geri Don')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-2xl mx-auto px-4">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('subscriptions.contact.back', 'Geri')}
          </button>
          <h1 className="text-3xl font-bold text-slate-900">
            {t('subscriptions.contact.title', 'Iletisime Gecin')}
          </h1>
          <p className="text-slate-600 mt-2">
            {t('subscriptions.contact.subtitle', 'Abonelik talebiniz icin bizimle iletisime gecin')}
          </p>
        </div>

        {contactData && (
          <div className="space-y-6">
            {/* Plan Info Card */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="font-semibold text-slate-900 mb-4">
                {t('subscriptions.contact.planDetails', 'Plan Detaylari')}
              </h2>
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-xl font-bold text-slate-900">
                    {type === 'upgrade' ? contactData.newPlanName : contactData.planName}
                  </p>
                  <p className="text-slate-600">
                    {contactData.billingCycle === 'MONTHLY'
                      ? t('subscriptions.monthly')
                      : t('subscriptions.yearly')}
                  </p>
                  {type === 'upgrade' && contactData.currentPlanName && (
                    <p className="text-sm text-slate-500 mt-1">
                      {t('subscriptions.contact.upgradeFrom', 'Yukseltme:')} {contactData.currentPlanName}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-3xl font-bold text-indigo-600">
                    {formatCurrency(contactData.amount, contactData.currency)}
                  </p>
                  <p className="text-sm text-slate-500">
                    {contactData.billingCycle === 'MONTHLY'
                      ? t('subscriptions.perMonth')
                      : t('subscriptions.perYear')}
                  </p>
                </div>
              </div>
            </div>

            {/* Contact Options */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <h2 className="font-semibold text-slate-900 mb-4">
                {t('subscriptions.contact.contactUs', 'Bizimle Iletisime Gecin')}
              </h2>
              <div className="space-y-4">
                {/* WhatsApp Button */}
                <button
                  onClick={handleWhatsAppClick}
                  className="w-full flex items-center gap-4 p-4 bg-green-50 hover:bg-green-100 border border-green-200 rounded-xl transition-colors group"
                >
                  <div className="w-14 h-14 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <MessageCircle className="w-7 h-7 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-slate-900 text-lg">
                      {t('subscriptions.contact.whatsapp', 'WhatsApp ile Iletisim')}
                    </p>
                    <p className="text-slate-600">{contactData.whatsappNumber}</p>
                  </div>
                  <ExternalLink className="w-6 h-6 text-green-600 group-hover:translate-x-1 transition-transform" />
                </button>

                {/* Email Button */}
                <button
                  onClick={handleEmailClick}
                  className="w-full flex items-center gap-4 p-4 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-colors group"
                >
                  <div className="w-14 h-14 bg-indigo-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <Mail className="w-7 h-7 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-slate-900 text-lg">
                      {t('subscriptions.contact.email', 'E-posta Gonder')}
                    </p>
                    <p className="text-slate-600">{contactData.email}</p>
                  </div>
                  <ExternalLink className="w-6 h-6 text-indigo-600 group-hover:translate-x-1 transition-transform" />
                </button>

                {/* Phone Info */}
                <div className="flex items-center gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="w-14 h-14 bg-slate-400 rounded-full flex items-center justify-center flex-shrink-0">
                    <Phone className="w-7 h-7 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-semibold text-slate-900 text-lg">
                      {t('subscriptions.contact.phone', 'Telefon')}
                    </p>
                    <p className="text-slate-600">{contactData.whatsappNumber}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Info Note */}
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-sm text-blue-800">
                {t('subscriptions.contact.note', 'WhatsApp veya e-posta ile iletisime gectiginizde, ekibimiz en kisa surede sizinle iletisime gececek ve odeme islemlerinizi tamamlamaniza yardimci olacaktir.')}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

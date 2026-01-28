import { useTranslation } from 'react-i18next';
import { MessageCircle, Mail, Phone, X, ExternalLink } from 'lucide-react';

interface ContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  planName: string;
  billingCycle: string;
  amount: number;
  currency: string;
  whatsappLink: string;
  emailLink: string;
  whatsappNumber: string;
  email: string;
}

export function ContactModal({
  isOpen,
  onClose,
  planName,
  billingCycle,
  amount,
  currency,
  whatsappLink,
  emailLink,
  whatsappNumber,
  email,
}: ContactModalProps) {
  const { t } = useTranslation('subscriptions');

  if (!isOpen) return null;

  const formatCurrency = (amount: number, currency: string) => {
    if (currency === 'TRY' || currency === 'TL') {
      return `${amount.toFixed(2)} TL`;
    }
    return `${amount.toFixed(2)} ${currency}`;
  };

  const handleWhatsAppClick = () => {
    window.open(whatsappLink, '_blank');
  };

  const handleEmailClick = () => {
    window.location.href = emailLink;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-8 text-white text-center">
          <h2 className="text-2xl font-bold mb-2">
            {t('subscriptions.contact.title', 'Iletisime Gecin')}
          </h2>
          <p className="text-indigo-100">
            {t('subscriptions.contact.subtitle', 'Abonelik talebiniz icin bizimle iletisime gecin')}
          </p>
        </div>

        {/* Plan Info */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm text-slate-500">{t('subscriptions.contact.selectedPlan', 'Secilen Plan')}</p>
              <p className="font-semibold text-slate-900">{planName}</p>
              <p className="text-sm text-slate-600">
                {billingCycle === 'MONTHLY' ? t('subscriptions.monthly') : t('subscriptions.yearly')}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-indigo-600">
                {formatCurrency(amount, currency)}
              </p>
              <p className="text-xs text-slate-500">
                {billingCycle === 'MONTHLY' ? t('subscriptions.perMonth') : t('subscriptions.perYear')}
              </p>
            </div>
          </div>
        </div>

        {/* Contact Options */}
        <div className="p-6 space-y-4">
          {/* WhatsApp Button */}
          <button
            onClick={handleWhatsAppClick}
            className="w-full flex items-center gap-4 p-4 bg-green-50 hover:bg-green-100 border border-green-200 rounded-xl transition-colors group"
          >
            <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
              <MessageCircle className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold text-slate-900">
                {t('subscriptions.contact.whatsapp', 'WhatsApp ile Iletisim')}
              </p>
              <p className="text-sm text-slate-600">{whatsappNumber}</p>
            </div>
            <ExternalLink className="w-5 h-5 text-green-600 group-hover:translate-x-1 transition-transform" />
          </button>

          {/* Email Button */}
          <button
            onClick={handleEmailClick}
            className="w-full flex items-center gap-4 p-4 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl transition-colors group"
          >
            <div className="w-12 h-12 bg-indigo-500 rounded-full flex items-center justify-center flex-shrink-0">
              <Mail className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold text-slate-900">
                {t('subscriptions.contact.email', 'E-posta Gonder')}
              </p>
              <p className="text-sm text-slate-600">{email}</p>
            </div>
            <ExternalLink className="w-5 h-5 text-indigo-600 group-hover:translate-x-1 transition-transform" />
          </button>

          {/* Phone Info */}
          <div className="flex items-center gap-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="w-12 h-12 bg-slate-400 rounded-full flex items-center justify-center flex-shrink-0">
              <Phone className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-semibold text-slate-900">
                {t('subscriptions.contact.phone', 'Telefon')}
              </p>
              <p className="text-sm text-slate-600">{whatsappNumber}</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200">
          <p className="text-xs text-slate-500 text-center">
            {t('subscriptions.contact.note', 'Talebiniz ekibimize iletildi. En kisa surede sizinle iletisime gecilebilir.')}
          </p>
        </div>
      </div>
    </div>
  );
}

export default ContactModal;

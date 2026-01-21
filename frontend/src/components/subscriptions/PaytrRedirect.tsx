import { useState } from 'react';
import { Loader2, Lock, ExternalLink, CreditCard, Shield } from 'lucide-react';

interface PaytrRedirectProps {
  paymentLink: string;
  amount: number;
  currency: string;
  planName?: string;
}

export function PaytrRedirect({
  paymentLink,
  amount,
  currency,
  planName,
}: PaytrRedirectProps) {
  const [isRedirecting, setIsRedirecting] = useState(false);

  const handlePayment = () => {
    setIsRedirecting(true);
    window.location.href = paymentLink;
  };

  const formatCurrency = (amount: number, currency: string) => {
    if (currency === 'TRY' || currency === 'TL') {
      return `${amount.toFixed(2)} TL`;
    }
    return `${amount.toFixed(2)} ${currency}`;
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-8">
      <div className="text-center">
        {/* Icon */}
        <div className="mb-6">
          <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CreditCard className="w-10 h-10 text-indigo-600" />
          </div>
          <h3 className="text-xl font-semibold text-slate-900 mb-2">
            {planName ? `${planName} Plan Odemesi` : 'Odeme'}
          </h3>
          <p className="text-slate-600">
            Guvenli odeme sayfasina yonlendirileceksiniz
          </p>
        </div>

        {/* Amount Display */}
        <div className="bg-slate-50 rounded-lg p-6 mb-6">
          <p className="text-sm text-slate-600 mb-1">Toplam Tutar</p>
          <p className="text-4xl font-bold text-slate-900">
            {formatCurrency(amount, currency)}
          </p>
        </div>

        {/* Payment Button */}
        <button
          onClick={handlePayment}
          disabled={isRedirecting}
          className="w-full px-6 py-4 bg-indigo-600 text-white rounded-lg
                     hover:bg-indigo-700 disabled:bg-slate-400 transition-colors
                     font-semibold text-lg flex items-center justify-center gap-3"
        >
          {isRedirecting ? (
            <>
              <Loader2 className="w-6 h-6 animate-spin" />
              Yonlendiriliyor...
            </>
          ) : (
            <>
              <Lock className="w-5 h-5" />
              Odemeye Devam Et
              <ExternalLink className="w-5 h-5" />
            </>
          )}
        </button>

        {/* Security Info */}
        <div className="mt-6 flex items-center justify-center gap-2 text-sm text-slate-500">
          <Shield className="w-4 h-4" />
          <span>PayTR guvenli odeme altyapisi ile korunmaktasiniz</span>
        </div>

        {/* Payment Methods */}
        <div className="mt-6 pt-6 border-t border-slate-200">
          <p className="text-xs text-slate-500 mb-3">Desteklenen Odeme Yontemleri</p>
          <div className="flex items-center justify-center gap-4">
            <div className="px-3 py-1 bg-slate-100 rounded text-xs font-medium text-slate-700">
              Visa
            </div>
            <div className="px-3 py-1 bg-slate-100 rounded text-xs font-medium text-slate-700">
              Mastercard
            </div>
            <div className="px-3 py-1 bg-slate-100 rounded text-xs font-medium text-slate-700">
              Troy
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import axios from 'axios';
import { Phone, Check, Loader2 } from 'lucide-react';
import { isValidPhone } from '../../utils/validation';

interface PhoneVerificationProps {
  tenantId: string;
  sessionId?: string;
  onVerified: (phone: string) => void;
  primaryColor?: string;
}

const PhoneVerification = ({
  tenantId,
  sessionId,
  onVerified,
  primaryColor = '#FF6B6B',
}: PhoneVerificationProps) => {
  const { t } = useTranslation('common');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [isLoading, setIsLoading] = useState(false);
  const [verificationId, setVerificationId] = useState<string | null>(null);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();

    // Phone validation with E.164 format check
    if (!phone || !isValidPhone(phone)) {
      toast.error(t('phoneVerification.invalidPhone', 'Please enter a valid phone number'));
      return;
    }

    setIsLoading(true);
    try {
      const response = await axios.post(`${API_URL}/customer-public/phone/send-otp`, {
        phone,
        sessionId,
        tenantId,
      });

      setVerificationId(response.data.verificationId);
      setStep('code');
      toast.success(
        t(
          'phoneVerification.otpSent',
          'Verification code sent! (Check console in development)'
        )
      );
    } catch (error: any) {
      console.error('Failed to send OTP:', error);
      toast.error(
        error.response?.data?.message ||
          t('phoneVerification.otpFailed', 'Failed to send verification code')
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!code || code.length !== 6) {
      toast.error(t('phoneVerification.invalidCode', 'Please enter a 6-digit code'));
      return;
    }

    setIsLoading(true);
    try {
      await axios.post(`${API_URL}/customer-public/phone/verify-otp`, {
        phone,
        code,
        tenantId,
      });

      toast.success(t('phoneVerification.verified', 'Phone number verified!'));
      onVerified(phone);
    } catch (error: any) {
      console.error('Failed to verify OTP:', error);
      toast.error(
        error.response?.data?.message ||
          t('phoneVerification.verifyFailed', 'Invalid verification code')
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (step === 'phone') {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-6 animate-in fade-in zoom-in-95 duration-300">
        <div
          className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
          style={{ backgroundColor: `${primaryColor}15` }}
        >
          <Phone className="h-8 w-8" style={{ color: primaryColor }} />
        </div>

        <h2 className="text-2xl font-bold text-center mb-2">
          {t('phoneVerification.title', 'Verify Your Phone')}
        </h2>
        <p className="text-slate-600 text-center mb-6">
          {t(
            'phoneVerification.subtitle',
            'Enter your phone number to receive a verification code'
          )}
        </p>

        <form onSubmit={handleSendOTP}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              {t('phoneVerification.phoneLabel', 'Phone Number')}
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+905551234567"
              className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-opacity-50 text-lg"
              style={{ focusRing: primaryColor }}
              disabled={isLoading}
              autoFocus
            />
            <p className="text-xs text-slate-500 mt-1">
              {t('phoneVerification.phoneHint', 'Include country code (e.g., +90)')}
            </p>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 rounded-lg font-semibold text-white transition-all duration-200 transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2"
            style={{ backgroundColor: primaryColor }}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                {t('common.sending', 'Sending...')}
              </>
            ) : (
              <>
                {t('phoneVerification.sendCode', 'Send Verification Code')}
              </>
            )}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 animate-in fade-in zoom-in-95 duration-300">
      <div
        className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
        style={{ backgroundColor: `${primaryColor}15` }}
      >
        <Check className="h-8 w-8" style={{ color: primaryColor }} />
      </div>

      <h2 className="text-2xl font-bold text-center mb-2">
        {t('phoneVerification.enterCode', 'Enter Verification Code')}
      </h2>
      <p className="text-slate-600 text-center mb-6">
        {t('phoneVerification.codeSent', `Code sent to ${phone}`)}
      </p>

      <form onSubmit={handleVerifyOTP}>
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-2">
            {t('phoneVerification.codeLabel', '6-Digit Code')}
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-opacity-50 text-lg text-center tracking-widest font-mono"
            style={{ focusRing: primaryColor }}
            disabled={isLoading}
            autoFocus
            maxLength={6}
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-3 rounded-lg font-semibold text-white transition-all duration-200 transform hover:scale-105 active:scale-95 flex items-center justify-center gap-2 mb-3"
          style={{ backgroundColor: primaryColor }}
        >
          {isLoading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              {t('common.verifying', 'Verifying...')}
            </>
          ) : (
            <>
              {t('phoneVerification.verify', 'Verify')}
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => setStep('phone')}
          className="w-full py-2 text-sm text-slate-600 hover:text-slate-900"
          disabled={isLoading}
        >
          {t('phoneVerification.changeNumber', 'Change phone number')}
        </button>
      </form>
    </div>
  );
};

export default PhoneVerification;

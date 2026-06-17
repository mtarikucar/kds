import React from 'react';
import { useTranslation } from 'react-i18next';
import { GoogleLogin } from '@react-oauth/google';

interface SocialLoginButtonsProps {
  /**
   * Called with the Google ID token (the GIS `credential`) on a successful
   * sign-in. The backend verifies this JWT (signature + audience + issuer +
   * expiry) — the secure, Google-recommended flow for authentication. No
   * access token ever touches the browser (the old implicit flow did, which
   * Google flagged as an impersonation risk).
   */
  onGoogleSuccess: (credential: string) => void;
  onGoogleError?: () => void;
  disabled?: boolean;
  variant?: 'login' | 'register';
}

const SocialLoginButtons: React.FC<SocialLoginButtonsProps> = ({
  onGoogleSuccess,
  onGoogleError,
  disabled = false,
  variant = 'login',
}) => {
  const { t } = useTranslation(['auth']);

  const dividerText =
    variant === 'login'
      ? t('auth:login.orContinueWith', 'or continue with')
      : t('auth:register.orSignUpWith', 'or sign up with');

  return (
    <div className="space-y-4">
      {/* Divider */}
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-slate-200" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-white text-slate-500">{dividerText}</span>
        </div>
      </div>

      {/* Official "Sign in with Google" button (Google Identity Services).
          Returns an ID token via onSuccess — the secure flow + the
          brand-compliant button Google's OAuth verification requires. */}
      <div
        className={`flex justify-center ${
          disabled ? 'pointer-events-none opacity-50' : ''
        }`}
        aria-disabled={disabled}
      >
        <GoogleLogin
          onSuccess={(resp) => {
            if (resp.credential) onGoogleSuccess(resp.credential);
          }}
          onError={() => onGoogleError?.()}
          text={variant === 'login' ? 'signin_with' : 'signup_with'}
          theme="outline"
          size="large"
          shape="rectangular"
          logo_alignment="left"
          width={320}
        />
      </div>
    </div>
  );
};

export { SocialLoginButtons };
export default SocialLoginButtons;

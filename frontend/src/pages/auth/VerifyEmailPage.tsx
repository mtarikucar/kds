import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useVerifyEmail, useResendVerificationEmail } from '../../features/auth/authApi';
import Button from '../../components/ui/Button';
import { useAuthStore } from '../../store/authStore';

const CODE_LENGTH = 6;

const VerifyEmailPage = () => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const storedUser = useAuthStore((state) => state.user);

  const [email, setEmail] = useState(storedUser?.email ?? '');
  const [code, setCode] = useState('');
  const [state, setState] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const { mutate: verifyEmail, isPending: isVerifying } = useVerifyEmail();
  const { mutate: resendVerification, isPending: isResending } = useResendVerificationEmail();

  useEffect(() => {
    if (!isAuthenticated && !storedUser?.email) {
      // Allow unauthenticated users to enter email manually; no redirect.
    }
  }, [isAuthenticated, storedUser?.email]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    if (!email || code.length !== CODE_LENGTH) return;
    verifyEmail(
      { email, code },
      {
        onSuccess: () => {
          setState('success');
          setTimeout(() => {
            navigate(isAuthenticated ? '/dashboard' : '/login');
          }, 2000);
        },
        onError: (error: any) => {
          setState('error');
          setErrorMessage(
            error.response?.data?.message ||
              'Verification failed. The code may be expired or invalid.',
          );
        },
      },
    );
  };

  if (state === 'success') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-xl border border-slate-200/60 shadow-sm p-8">
          <h1 className="text-2xl font-heading font-bold text-slate-900 text-center mb-6">
            {t('verifyEmail.success')}
          </h1>
          <div className="text-center">
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-slate-600 mb-4">{t('verifyEmail.successMessage')}</p>
            <p className="text-sm text-slate-500 mb-6">{t('verifyEmail.redirecting')}</p>
            <Link to={isAuthenticated ? '/dashboard' : '/login'}>
              <Button className="w-full">
                {isAuthenticated ? t('verifyEmail.goToDashboard') : t('verifyEmail.goToLogin')}
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl border border-slate-200/60 shadow-sm p-8">
        <h1 className="text-2xl font-heading font-bold text-slate-900 text-center mb-2">
          {t('verifyEmail.title')}
        </h1>
        <p className="text-sm text-slate-500 text-center mb-6">{t('verifyEmail.description')}</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="verify-email" className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              id="verify-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isAuthenticated && !!storedUser?.email}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
            />
          </div>

          <div>
            <label htmlFor="verify-code" className="block text-sm font-medium text-slate-700 mb-1">
              {t('verifyEmail.codeLabel', 'Verification code')}
            </label>
            <input
              id="verify-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={CODE_LENGTH}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
              placeholder="123456"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg tracking-[0.4em] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-slate-500">{t('verifyEmail.checkInbox')}</p>
          </div>

          {state === 'error' && (
            <p className="text-sm text-red-600" role="alert">
              {errorMessage}
            </p>
          )}

          <Button type="submit" className="w-full" isLoading={isVerifying} disabled={code.length !== CODE_LENGTH}>
            {t('verifyEmail.verifying', 'Verify')}
          </Button>
        </form>

        <div className="mt-6 pt-4 border-t border-slate-200/60 space-y-2">
          {isAuthenticated && (
            <Button variant="outline" onClick={() => resendVerification()} className="w-full" isLoading={isResending}>
              {t('verifyEmail.resendEmail')}
            </Button>
          )}
          <Link to={isAuthenticated ? '/dashboard' : '/login'}>
            <Button variant="outline" className="w-full">
              {isAuthenticated ? t('verifyEmail.backToDashboard') : t('verifyEmail.backToLogin')}
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
};

export default VerifyEmailPage;

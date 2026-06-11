import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useGoogleLogin } from '@react-oauth/google';
import { useLogin, useGoogleAuth } from '../../features/auth/authApi';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import PasswordInput from '../../components/ui/PasswordInput';
import Checkbox from '../../components/ui/Checkbox';
import SocialLoginButtons from '../../components/ui/SocialLoginButtons';
import AuthLayout from '../../components/auth/AuthLayout';
import { useAuthStore } from '../../store/authStore';
import { AlertCircle, CheckCircle } from 'lucide-react';

interface LocationState {
  pendingApproval?: boolean;
  message?: string;
  // Set by ProtectedRoute when it bounces an unauthenticated visitor.
  // Carries the original `pathname + search + hash` so deeplinks (e.g.
  // /admin/store?sku=... from the landing storefront) survive login.
  from?: string;
}

// One-shot read of the post-login return path stashed by api.ts's 401
// response interceptor (warm-session expiry → hard reload → React
// Router state would be wiped). Clears on read so a subsequent visit
// to /login doesn't reuse a stale target.
function readAndClearReturnPath(): string | null {
  try {
    const value = window.sessionStorage.getItem('postLoginReturn');
    if (value) window.sessionStorage.removeItem('postLoginReturn');
    return value;
  } catch {
    return null;
  }
}

const LoginPage = () => {
  const { t } = useTranslation(['auth', 'validation']);
  const [rememberMe, setRememberMe] = useState(false);
  const location = useLocation();
  const locationState = location.state as LocationState | null;

  const loginSchema = z.object({
    email: z.string().email(t('validation:email')),
    password: z.string().min(6, t('validation:minLength', { count: 6 })),
  });

  type LoginFormData = z.infer<typeof loginSchema>;

  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { mutate: login, isPending } = useLogin();
  const { mutate: googleAuth, isPending: isGooglePending } = useGoogleAuth();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    mode: 'onBlur',
  });

  // Post-login redirect target. Two paths feed it:
  //   1. `state.from` — set by ProtectedRoute when it bounced an
  //      unauthenticated visitor on a cold deeplink (cheap, in-SPA).
  //   2. sessionStorage `postLoginReturn` — set by api.ts's 401
  //      response interceptor when a warm session expires and we
  //      do a hard `window.location.href` reload (history.state
  //      doesn't survive that). One-shot — cleared on read.
  // Either path runs through the same internal-path regex so an
  // attacker can't sneak `//evil.com` or `http://evil.com` in.
  const postLoginTarget = useMemo(() => {
    const candidate =
      locationState?.from ||
      (typeof window !== 'undefined' ? readAndClearReturnPath() : null);
    // v2.8.97 — tighter shape check. Pre-fix the regex `^/[^/]` accepted
    // any path starting with a single-slash + non-slash char, which
    // let `/javascript:alert(1)` and other weird shapes through to
    // navigate(). The new check additionally rejects:
    //   - protocol-relative `//evil.com` (already covered by [^/] but
    //     pinned explicitly)
    //   - any `:` in the path (kills `javascript:` and other URIs)
    //   - backslashes (kills `\\evil.com` IE-style absolute URLs)
    //   - the /login self-loop
    if (
      candidate &&
      typeof candidate === 'string' &&
      candidate.length < 1024 &&
      /^\/[a-zA-Z0-9_\-/?#=&%.]*$/.test(candidate) &&
      !candidate.startsWith('//') &&
      !candidate.startsWith('/login')
    ) {
      return candidate;
    }
    return '/dashboard';
    // Computed once at mount; failed-login re-renders don't change it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      navigate(postLoginTarget, { replace: true });
    }
  }, [isAuthenticated, navigate, postLoginTarget]);

  const onSubmit = (data: LoginFormData) => {
    login(data, {
      onSuccess: () => {
        navigate(postLoginTarget, { replace: true });
      },
    });
  };

  // Google OAuth handler - uses popup flow with access token
  const handleGoogleLogin = useGoogleLogin({
    onSuccess: (tokenResponse) => {
      googleAuth(tokenResponse.access_token, {
        onSuccess: () => {
          navigate(postLoginTarget, { replace: true });
        },
      });
    },
    onError: (error) => {
      console.error('Google login error:', error);
    },
    flow: 'implicit',
  });

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.4,
      },
    },
  };

  return (
    <AuthLayout variant="login">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="w-full"
      >
        {/* Pending Approval Banner */}
        {locationState?.pendingApproval && (
          <motion.div
            variants={itemVariants}
            className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3"
          >
            <CheckCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-800 font-medium">{t('auth:login.registrationSuccessful')}</p>
              <p className="text-amber-700 text-sm mt-1">
                {locationState.message || t('auth:login.pendingApprovalMessage')}
              </p>
            </div>
          </motion.div>
        )}

        {/* Header */}
        <motion.div variants={itemVariants} className="text-center mb-8">
          <h1 className="text-3xl font-heading font-bold text-slate-900 mb-2">
            {t('auth:login.welcomeBack', 'Welcome Back')}
          </h1>
          <p className="text-slate-600">
            {t('auth:login.subtitle', 'Sign in to continue managing your restaurant')}
          </p>
        </motion.div>

        {/* Form */}
        <motion.form
          variants={containerVariants}
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-5"
        >
          <motion.div variants={itemVariants}>
            <Input
              label={t('auth:login.email')}
              type="email"
              placeholder="you@example.com"
              error={errors.email?.message}
              autoComplete="email"
              {...register('email')}
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            <PasswordInput
              label={t('auth:login.password')}
              placeholder="••••••••"
              error={errors.password?.message}
              autoComplete="current-password"
              {...register('password')}
            />
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="flex items-center justify-between"
          >
            <Checkbox
              label={t('auth:login.rememberMe', 'Remember me')}
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <Link
              to="/forgot-password"
              className="text-sm text-primary-600 hover:text-primary-700 font-medium transition-colors"
            >
              {t('auth:login.forgotPassword')}
            </Link>
          </motion.div>

          <motion.div variants={itemVariants}>
            <Button
              type="submit"
              className="w-full py-2.5"
              isLoading={isPending}
              disabled={isGooglePending}
            >
              {t('auth:login.submit')}
            </Button>
          </motion.div>

          <motion.div variants={itemVariants}>
            <SocialLoginButtons
              variant="login"
              onGoogleClick={() => {
                // v2.8.97 — disable while either auth path is already in
                // flight. Pre-fix a quick double-click on the Google
                // button while the popup was opening (or a stale ref
                // re-firing) would queue a second mutation; the cache
                // clear in useGoogleAuth would land twice, and the
                // navigate() would race the prior one.
                if (isPending || isGooglePending) return;
                handleGoogleLogin();
              }}
              disabled={isPending || isGooglePending}
              isLoading={isGooglePending}
            />
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="text-center text-sm text-slate-600 pt-2"
          >
            {t('auth:login.noAccount')}{' '}
            <Link
              to="/register"
              className="text-primary-600 hover:text-primary-700 font-semibold transition-colors"
            >
              {t('auth:login.register')}
            </Link>
          </motion.div>
        </motion.form>
      </motion.div>
    </AuthLayout>
  );
};

export default LoginPage;

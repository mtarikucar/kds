import { useEffect, useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
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
import { isGoogleAuthAvailable } from '../../utils/googleAuth';

const LoginPage = () => {
  const { t } = useTranslation(['auth', 'validation']);
  const [rememberMe, setRememberMe] = useState(false);
  const googleAuthAvailable = useMemo(() => isGoogleAuthAvailable(), []);

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

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  const onSubmit = (data: LoginFormData) => {
    login(data, {
      onSuccess: () => {
        navigate('/dashboard');
      },
    });
  };

  // Google OAuth handler - uses popup flow with access token
  const handleGoogleLogin = useGoogleLogin({
    onSuccess: (tokenResponse) => {
      googleAuth(tokenResponse.access_token, {
        onSuccess: () => {
          navigate('/dashboard');
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

          {googleAuthAvailable && (
            <motion.div variants={itemVariants}>
              <SocialLoginButtons
                variant="login"
                onGoogleClick={() => handleGoogleLogin()}
                disabled={isPending}
                isLoading={isGooglePending}
              />
            </motion.div>
          )}

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

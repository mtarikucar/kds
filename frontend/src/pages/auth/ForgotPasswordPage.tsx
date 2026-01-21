import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useForgotPassword } from '../../features/auth/authApi';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import AuthLayout from '../../components/auth/AuthLayout';
import { useState } from 'react';

const ForgotPasswordPage = () => {
  const { t } = useTranslation(['auth', 'validation']);
  const [emailSent, setEmailSent] = useState(false);
  const { mutate: forgotPassword, isPending } = useForgotPassword();

  const forgotPasswordSchema = z.object({
    email: z.string().email(t('validation:email')),
  });

  type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordFormData>({
    resolver: zodResolver(forgotPasswordSchema),
  });

  const onSubmit = (data: ForgotPasswordFormData) => {
    forgotPassword(data.email, {
      onSuccess: () => {
        setEmailSent(true);
      },
    });
  };

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

  if (emailSent) {
    return (
      <AuthLayout variant="forgot-password">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="w-full"
        >
          <motion.div variants={itemVariants} className="text-center">
            <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <svg
                className="w-8 h-8 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-heading font-bold text-slate-900 mb-2">
              {t('auth:forgotPassword.checkEmail')}
            </h1>
            <p className="text-slate-600 mb-4">
              {t('auth:forgotPassword.emailSent')}
            </p>
            <p className="text-sm text-slate-500 mb-6">
              {t('auth:forgotPassword.emailExpiry')}
            </p>
          </motion.div>

          <motion.div variants={itemVariants} className="pt-4 border-t border-slate-200/60">
            <Link
              to="/login"
              className="text-primary-600 hover:text-primary-700 font-medium text-sm block text-center transition-colors"
            >
              {t('auth:forgotPassword.backToLogin')}
            </Link>
          </motion.div>
        </motion.div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout variant="forgot-password">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="w-full"
      >
        {/* Header */}
        <motion.div variants={itemVariants} className="text-center mb-6">
          <h1 className="text-3xl font-heading font-bold text-slate-900 mb-2">
            {t('auth:forgotPassword.title')}
          </h1>
          <p className="text-slate-600">
            {t('auth:forgotPassword.description')}
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
              label={t('auth:forgotPassword.email')}
              type="email"
              placeholder="you@example.com"
              error={errors.email?.message}
              autoComplete="email"
              {...register('email')}
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            <Button type="submit" className="w-full py-2.5" isLoading={isPending}>
              {t('auth:forgotPassword.submit')}
            </Button>
          </motion.div>

          <motion.div variants={itemVariants} className="text-center text-sm space-y-2">
            <div>
              <Link
                to="/login"
                className="text-primary-600 hover:text-primary-700 font-medium transition-colors"
              >
                {t('auth:forgotPassword.backToLogin')}
              </Link>
            </div>
            <div className="text-slate-600">
              {t('auth:forgotPassword.noAccount')}{' '}
              <Link
                to="/register"
                className="text-primary-600 hover:text-primary-700 font-medium transition-colors"
              >
                {t('auth:forgotPassword.register')}
              </Link>
            </div>
          </motion.div>
        </motion.form>
      </motion.div>
    </AuthLayout>
  );
};

export default ForgotPasswordPage;

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useResetPassword } from '../../features/auth/authApi';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';

const ResetPasswordPage = () => {
  const { t } = useTranslation(['auth', 'validation']);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [resetSuccess, setResetSuccess] = useState(false);

  const { mutate: resetPassword, isPending } = useResetPassword();

  const resetPasswordSchema = z
    .object({
      newPassword: z.string().min(8, t('validation:minLength', { count: 8 })),
      confirmPassword: z.string(),
    })
    .refine((data) => data.newPassword === data.confirmPassword, {
      message: t('auth:resetPassword.passwordMismatch'),
      path: ['confirmPassword'],
    });

  type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordFormData>({
    resolver: zodResolver(resetPasswordSchema),
  });

  useEffect(() => {
    if (!token) {
      // Redirect to forgot password if no token present
      navigate('/forgot-password');
    }
  }, [token, navigate]);

  const onSubmit = (data: ResetPasswordFormData) => {
    if (!token) return;

    resetPassword(
      { token, newPassword: data.newPassword },
      {
        onSuccess: () => {
          setResetSuccess(true);
          // Redirect to login after 3 seconds
          setTimeout(() => {
            navigate('/login');
          }, 3000);
        },
      }
    );
  };

  if (resetSuccess) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white rounded-xl border border-slate-200/60 shadow-sm p-8">
          <h1 className="text-2xl font-heading font-bold text-slate-900 text-center mb-6">{t('auth:resetPassword.passwordReset')}</h1>
          <div className="space-y-4">
            <div className="text-center">
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
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <p className="text-slate-600 mb-4">
                {t('auth:resetPassword.passwordResetMessage')}
              </p>
              <p className="text-sm text-slate-500 mb-6">
                {t('auth:resetPassword.redirecting')}
              </p>
            </div>

            <Link to="/login">
              <Button className="w-full">{t('auth:resetPassword.goToLogin')}</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!token) {
    return null; // Will redirect via useEffect
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-xl border border-slate-200/60 shadow-sm p-8">
        <h1 className="text-2xl font-heading font-bold text-slate-900 text-center mb-6">{t('auth:resetPassword.title')}</h1>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="text-center mb-4">
            <p className="text-slate-600 text-sm">
              {t('auth:resetPassword.description')}
            </p>
          </div>

          <Input
            label={t('auth:resetPassword.newPassword')}
            type="password"
            placeholder={t('auth:resetPassword.newPassword')}
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />

          <Input
            label={t('auth:resetPassword.confirmPassword')}
            type="password"
            placeholder={t('auth:resetPassword.confirmPassword')}
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800">
            <p className="font-medium mb-1">{t('auth:resetPassword.requirements')}</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>{t('auth:resetPassword.requirement1')}</li>
              <li>{t('auth:resetPassword.requirement2')}</li>
              <li>{t('auth:resetPassword.requirement3')}</li>
            </ul>
          </div>

          <Button type="submit" className="w-full" isLoading={isPending}>
            {t('auth:resetPassword.submit')}
          </Button>

          <div className="text-center text-sm">
            <Link
              to="/login"
              className="text-primary-600 hover:text-primary-700 font-medium transition-colors"
            >
              Back to Login
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ResetPasswordPage;

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useForgotPassword } from '../../features/auth/authApi';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
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

  if (emailSent) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center text-2xl">{t('auth:forgotPassword.checkEmail')}</CardTitle>
          </CardHeader>
          <CardContent>
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
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <p className="text-gray-600 mb-4">
                  {t('auth:forgotPassword.emailSent')}
                </p>
                <p className="text-sm text-gray-500 mb-6">
                  {t('auth:forgotPassword.emailExpiry')}
                </p>
              </div>

              <div className="pt-4 border-t">
                <Link
                  to="/login"
                  className="text-blue-600 hover:text-blue-700 font-medium text-sm block text-center"
                >
                  {t('auth:forgotPassword.backToLogin')}
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-2xl">{t('auth:forgotPassword.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="text-center mb-4">
              <p className="text-gray-600 text-sm">
                {t('auth:forgotPassword.description')}
              </p>
            </div>

            <Input
              label={t('auth:forgotPassword.email')}
              type="email"
              placeholder={t('auth:forgotPassword.email')}
              error={errors.email?.message}
              {...register('email')}
            />

            <Button type="submit" className="w-full" isLoading={isPending}>
              {t('auth:forgotPassword.submit')}
            </Button>

            <div className="text-center text-sm space-y-2">
              <div>
                <Link
                  to="/login"
                  className="text-blue-600 hover:text-blue-700 font-medium"
                >
                  {t('auth:forgotPassword.backToLogin')}
                </Link>
              </div>
              <div className="text-gray-600">
                {t('auth:forgotPassword.noAccount')}{' '}
                <Link
                  to="/register"
                  className="text-blue-600 hover:text-blue-700 font-medium"
                >
                  {t('auth:forgotPassword.register')}
                </Link>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default ForgotPasswordPage;

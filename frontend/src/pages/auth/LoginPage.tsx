import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLogin } from '../../features/auth/authApi';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { useAuthStore } from '../../store/authStore';

const LoginPage = () => {
  const { t } = useTranslation(['auth', 'validation']);

  const loginSchema = z.object({
    email: z.string().email(t('validation:email')),
    password: z.string().min(6, t('validation:minLength', { count: 6 })),
  });

  type LoginFormData = z.infer<typeof loginSchema>;

  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const { mutate: login, isPending } = useLogin();

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

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-2xl">
            {t('auth:login.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label={t('auth:login.email')}
              type="email"
              placeholder={t('auth:login.email')}
              error={errors.email?.message}
              {...register('email')}
            />

            <div>
              <Input
                label={t('auth:login.password')}
                type="password"
                placeholder={t('auth:login.password')}
                error={errors.password?.message}
                {...register('password')}
              />
              <div className="text-right mt-1">
                <Link
                  to="/forgot-password"
                  className="text-sm text-blue-600 hover:text-blue-700"
                >
                  {t('auth:login.forgotPassword')}
                </Link>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              isLoading={isPending}
            >
              {t('auth:login.submit')}
            </Button>

            <div className="text-center text-sm text-gray-600">
              {t('auth:login.noAccount')}{' '}
              <Link
                to="/register"
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                {t('auth:login.register')}
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default LoginPage;

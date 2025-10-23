import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useRegister } from '../../features/auth/authApi';
import { useGetPublicTenants } from '../../api/tenantsApi';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import { UserRole } from '../../types';
import { useMemo } from 'react';

const RegisterPage = () => {
  const { t } = useTranslation(['auth', 'validation']);
  const navigate = useNavigate();
  const { mutate: register, isPending } = useRegister();
  const { data: tenants, isLoading: tenantsLoading } = useGetPublicTenants();

  const registerSchema = z.object({
    email: z.string().email(t('validation:email')),
    password: z.string().min(6, t('validation:minLength', { count: 6 })),
    firstName: z.string().min(1, t('validation:required')),
    lastName: z.string().min(1, t('validation:required')),
    role: z.nativeEnum(UserRole),
    restaurantName: z.string().optional(),
    tenantId: z.string().optional(),
  }).refine(
    (data) => {
      // If role is ADMIN, restaurantName is required
      if (data.role === UserRole.ADMIN) {
        return !!data.restaurantName;
      }
      // If role is not ADMIN, tenantId is required
      return !!data.tenantId;
    },
    {
      message: t('auth:register.roleRequired'),
      path: ['restaurantName'],
    }
  );

  type RegisterFormData = z.infer<typeof registerSchema>;

  const {
    register: registerField,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      role: UserRole.ADMIN,
    },
  });

  const selectedRole = watch('role');
  const isAdmin = selectedRole === UserRole.ADMIN;

  const onSubmit = (data: RegisterFormData) => {
    // Clean up: only send the relevant field based on role
    const payload: any = {
      email: data.email,
      password: data.password,
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
    };

    if (isAdmin) {
      payload.restaurantName = data.restaurantName;
    } else {
      payload.tenantId = data.tenantId;
    }

    register(payload, {
      onSuccess: () => {
        navigate('/login');
      },
    });
  };

  const roleOptions = [
    { value: UserRole.ADMIN, label: t('auth:register.adminRole') },
    { value: UserRole.MANAGER, label: t('auth:register.managerRole') },
    { value: UserRole.WAITER, label: t('auth:register.waiterRole') },
    { value: UserRole.KITCHEN, label: t('auth:register.kitchenRole') },
    { value: UserRole.COURIER, label: t('auth:register.courierRole') },
  ];

  const tenantOptions = useMemo(() => {
    if (!tenants) return [];
    return tenants.map((tenant) => ({
      value: tenant.id,
      label: tenant.name,
    }));
  }, [tenants]);

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-2xl">
            {t('auth:register.title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label={t('auth:register.email')}
              type="email"
              placeholder={t('auth:register.email')}
              error={errors.email?.message}
              {...registerField('email')}
            />

            <Input
              label={t('auth:register.password')}
              type="password"
              placeholder={t('auth:register.password')}
              error={errors.password?.message}
              {...registerField('password')}
            />

            <div className="grid grid-cols-2 gap-4">
              <Input
                label={t('auth:register.firstName')}
                placeholder={t('auth:register.firstName')}
                error={errors.firstName?.message}
                {...registerField('firstName')}
              />

              <Input
                label={t('auth:register.lastName')}
                placeholder={t('auth:register.lastName')}
                error={errors.lastName?.message}
                {...registerField('lastName')}
              />
            </div>

            <Select
              label={t('auth:register.role')}
              options={roleOptions}
              error={errors.role?.message}
              {...registerField('role')}
            />

            {isAdmin ? (
              <Input
                label={t('auth:register.restaurantName')}
                placeholder={t('auth:register.restaurantName')}
                error={errors.restaurantName?.message}
                {...registerField('restaurantName')}
              />
            ) : (
              <Select
                label={t('auth:register.selectRestaurant')}
                options={tenantOptions}
                error={errors.tenantId?.message}
                disabled={tenantsLoading || tenantOptions.length === 0}
                {...registerField('tenantId')}
              />
            )}

            <Button
              type="submit"
              className="w-full"
              isLoading={isPending}
            >
              {t('auth:register.submit')}
            </Button>

            <div className="text-center text-sm text-gray-600">
              {t('auth:register.haveAccount')}{' '}
              <Link
                to="/login"
                className="text-blue-600 hover:text-blue-700 font-medium"
              >
                {t('auth:register.login')}
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default RegisterPage;

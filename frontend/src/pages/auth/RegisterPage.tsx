import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useGoogleLogin } from '@react-oauth/google';
import { useRegister, useGoogleAuth } from '../../features/auth/authApi';
import { useGetPublicTenants } from '../../api/tenantsApi';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import PasswordInput from '../../components/ui/PasswordInput';
import PasswordStrength from '../../components/ui/PasswordStrength';
import Checkbox from '../../components/ui/Checkbox';
import FormSelect from '../../components/ui/FormSelect';
import SocialLoginButtons from '../../components/ui/SocialLoginButtons';
import AuthLayout from '../../components/auth/AuthLayout';
import { UserRole, RegisterRequest } from '../../types';

const RegisterPage = () => {
  const { t } = useTranslation(['auth', 'validation']);
  const navigate = useNavigate();
  const { mutate: registerUser, isPending } = useRegister();
  const { mutate: googleAuth, isPending: isGooglePending } = useGoogleAuth();
  const { data: tenants, isLoading: tenantsLoading } = useGetPublicTenants();
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const registerSchema = z.object({
    email: z.string().email(t('validation:email')),
    password: z.string().min(8, t('validation:minLength', { count: 8 })),
    firstName: z.string().min(1, t('validation:required')),
    lastName: z.string().min(1, t('validation:required')),
    role: z.nativeEnum(UserRole),
    restaurantName: z.string().optional(),
    tenantId: z.string().optional(),
  }).refine(
    (data) => {
      if (data.role === UserRole.ADMIN) {
        return !!data.restaurantName;
      }
      return !!data.tenantId;
    },
    {
      message: t('auth:register.roleRequired'),
      path: ['restaurantName'],
    }
  );

  type RegisterFormData = z.infer<typeof registerSchema>;

  const {
    register,
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
  const password = watch('password') || '';
  const isAdmin = selectedRole === UserRole.ADMIN;

  const onSubmit = (data: RegisterFormData) => {
    if (!acceptedTerms) {
      return;
    }

    const payload: RegisterRequest = {
      email: data.email,
      password: data.password,
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
    };

    if (isAdmin && data.restaurantName) {
      payload.restaurantName = data.restaurantName;
    }

    registerUser(payload, {
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
      console.error('Google signup error:', error);
    },
    flow: 'implicit',
  });

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.08,
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
    <AuthLayout variant="register">
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="w-full"
      >
        {/* Header */}
        <motion.div variants={itemVariants} className="text-center mb-6">
          <h1 className="text-3xl font-heading font-bold text-gray-900 mb-2">
            {t('auth:register.createAccount', 'Create Account')}
          </h1>
          <p className="text-gray-600">
            {t('auth:register.subtitle', 'Start managing your restaurant smarter')}
          </p>
        </motion.div>

        {/* Form */}
        <motion.form
          variants={containerVariants}
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
        >
          <motion.div variants={itemVariants}>
            <Input
              label={t('auth:register.email')}
              type="email"
              placeholder="you@example.com"
              error={errors.email?.message}
              autoComplete="email"
              {...register('email')}
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            <PasswordInput
              label={t('auth:register.password')}
              placeholder="••••••••"
              error={errors.password?.message}
              autoComplete="new-password"
              {...register('password')}
            />
            <PasswordStrength password={password} showRequirements={true} />
          </motion.div>

          <motion.div variants={itemVariants} className="grid grid-cols-2 gap-4">
            <Input
              label={t('auth:register.firstName')}
              placeholder={t('auth:profile.firstNamePlaceholder', 'John')}
              error={errors.firstName?.message}
              autoComplete="given-name"
              {...register('firstName')}
            />

            <Input
              label={t('auth:register.lastName')}
              placeholder={t('auth:profile.lastNamePlaceholder', 'Doe')}
              error={errors.lastName?.message}
              autoComplete="family-name"
              {...register('lastName')}
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            <FormSelect
              label={t('auth:register.role')}
              options={roleOptions}
              error={errors.role?.message}
              {...register('role')}
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            {isAdmin ? (
              <Input
                label={t('auth:register.restaurantName')}
                placeholder={t('auth:register.restaurantNamePlaceholder', 'My Restaurant')}
                error={errors.restaurantName?.message}
                {...register('restaurantName')}
              />
            ) : (
              <FormSelect
                label={t('auth:register.selectRestaurant')}
                options={tenantOptions}
                error={errors.tenantId?.message}
                disabled={tenantsLoading || tenantOptions.length === 0}
                placeholder={tenantsLoading ? 'Loading...' : 'Select a restaurant'}
                {...register('tenantId')}
              />
            )}
          </motion.div>

          <motion.div variants={itemVariants}>
            <Checkbox
              label={
                <span>
                  {t('auth:register.termsAgree', 'I agree to the')}{' '}
                  <Link
                    to="/terms"
                    className="text-primary-600 hover:text-primary-700 font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t('auth:register.termsOfService', 'Terms of Service')}
                  </Link>{' '}
                  {t('auth:register.and', 'and')}{' '}
                  <Link
                    to="/privacy"
                    className="text-primary-600 hover:text-primary-700 font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t('auth:register.privacyPolicy', 'Privacy Policy')}
                  </Link>
                </span>
              }
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            <Button
              type="submit"
              className="w-full py-2.5"
              isLoading={isPending}
              disabled={!acceptedTerms || isGooglePending}
            >
              {t('auth:register.submit')}
            </Button>
          </motion.div>

          <motion.div variants={itemVariants}>
            <SocialLoginButtons
              variant="register"
              onGoogleClick={() => handleGoogleLogin()}
              disabled={isPending}
              isLoading={isGooglePending}
            />
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="text-center text-sm text-gray-600 pt-2"
          >
            {t('auth:register.haveAccount')}{' '}
            <Link
              to="/login"
              className="text-primary-600 hover:text-primary-700 font-semibold transition-colors"
            >
              {t('auth:register.login')}
            </Link>
          </motion.div>
        </motion.form>
      </motion.div>
    </AuthLayout>
  );
};

export default RegisterPage;

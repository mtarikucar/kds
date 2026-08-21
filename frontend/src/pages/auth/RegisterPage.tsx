import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useRegister, useGoogleAuth } from '../../features/auth/authApi';
import { useGetPublicTenants } from '../../api/tenantsApi';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import PasswordInput from '../../components/ui/PasswordInput';
import PasswordStrength from '../../components/ui/PasswordStrength';
import PhoneInput from '../../components/ui/PhoneInput';
import { splitE164 } from '../../components/ui/phoneInputLogic';
import Checkbox from '../../components/ui/Checkbox';
import FormSelect from '../../components/ui/FormSelect';
import SocialLoginButtons from '../../components/ui/SocialLoginButtons';
import AuthLayout from '../../components/auth/AuthLayout';
import { UserRole, RegisterRequest } from '../../types';
import {
  SUPPORTED_COUNTRY_CODES,
  DEFAULT_COUNTRY_CODE,
  isSupportedCountryCode,
} from '../../lib/countries';

const RegisterPage = () => {
  const { t } = useTranslation(['auth', 'validation']);
  const navigate = useNavigate();
  const { mutate: registerUser, isPending } = useRegister();
  const { mutate: googleAuth, isPending: isGooglePending } = useGoogleAuth();
  const { data: tenants, isLoading: tenantsLoading } = useGetPublicTenants();
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const registerSchema = z.object({
    email: z.string().email(t('validation:validation.email', 'Please enter a valid email address')),
    password: z
      .string()
      .min(8, t('validation:validation.minLength', { count: 8, defaultValue: 'Must be at least {{count}} characters' }))
      // Mirrors the backend RegisterDto complexity rule — without it the API
      // rejected the form with an untranslated English class-validator
      // message after a "valid" client-side pass.
      .regex(
        /(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
        t(
          'validation:validation.passwordRequirements',
          'Password must contain at least 8 characters, including uppercase, lowercase, and numbers',
        ),
      ),
    firstName: z.string().min(1, t('validation:validation.required', 'This field is required')),
    lastName: z.string().min(1, t('validation:validation.required', 'This field is required')),
    // Required: PayTR checkout needs a phone. PhoneInput emits E.164 ("+90…")
    // or '' — so we require a non-empty E.164 value.
    phone: z
      .string()
      .regex(/^\+[1-9]\d{6,14}$/, t('auth:profile.phoneInvalid', 'Lütfen geçerli bir telefon numarası girin.')),
    role: z.nativeEnum(UserRole),
    restaurantName: z.string().optional(),
    tenantId: z.string().optional(),
    // Required — the country the restaurant operates in. Only the
    // platform's supported countries are ever valid input (see
    // lib/countries.ts); a full ISO list would let the operator pick a
    // country with no backend profile, which silently resolves to the
    // default and misleads them into thinking their choice took effect.
    countryCode: z.enum(SUPPORTED_COUNTRY_CODES, {
      errorMap: () => ({
        message: t('validation:validation.required', 'This field is required'),
      }),
    }),
  }).superRefine((data, ctx) => {
    // Attach the error to the field the CURRENT role actually renders:
    // admins see the restaurant-name input, staff see the tenant select.
    // Pre-fix the error always landed on ['restaurantName'], which is not
    // rendered for staff roles — a staff submit without a restaurant
    // silently did nothing.
    if (data.role === UserRole.ADMIN) {
      if (!data.restaurantName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('auth:register.roleRequired'),
          path: ['restaurantName'],
        });
      }
    } else if (!data.tenantId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: t('auth:register.roleRequired'),
        path: ['tenantId'],
      });
    }
  });

  type RegisterFormData = z.infer<typeof registerSchema>;

  const {
    register,
    handleSubmit,
    watch,
    control,
    setValue,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      role: UserRole.ADMIN,
      countryCode: DEFAULT_COUNTRY_CODE,
    },
  });

  const selectedRole = watch('role');
  const password = watch('password') || '';
  const isAdmin = selectedRole === UserRole.ADMIN;

  // Pre-fill countryCode from the phone's E.164 region — a SUGGESTION only.
  // Once the operator picks a country themselves, countryPinned flips and
  // this effect stops touching the field: a later phone edit must never
  // silently overwrite an explicit choice. Mirrors PhoneInput's own
  // countryPinned pattern (see PhoneInput.tsx) for the identical reason.
  const countryPinned = useRef(false);
  const phoneValue = watch('phone');
  useEffect(() => {
    if (countryPinned.current) return;
    const parsed = splitE164(phoneValue || '');
    const guessed = parsed?.country as string | undefined;
    if (isSupportedCountryCode(guessed)) {
      setValue('countryCode', guessed, { shouldValidate: true });
    }
    // An unsupported or absent region (incomplete phone, or a country the
    // platform doesn't support) leaves the current selection untouched
    // rather than flickering back to the default.
  }, [phoneValue, setValue]);

  const countryOptions = useMemo(
    () =>
      SUPPORTED_COUNTRY_CODES.map((code) => ({
        value: code,
        label: t(`auth:register.countryNames.${code}`, code),
      })),
    [t],
  );

  const onSubmit = (data: RegisterFormData) => {
    if (!acceptedTerms) {
      return;
    }

    const payload: RegisterRequest = {
      email: data.email,
      password: data.password,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      role: data.role,
      countryCode: data.countryCode,
    };

    if (isAdmin && data.restaurantName) {
      payload.restaurantName = data.restaurantName;
    } else if (data.tenantId) {
      payload.tenantId = data.tenantId;
    }

    registerUser(payload, {
      onSuccess: (response) => {
        if (response.pendingApproval) {
          // User needs admin approval - navigate to login with message
          navigate('/login', {
            state: {
              pendingApproval: true,
              message: response.message
            }
          });
        } else {
          navigate('/login');
        }
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

  // Google sign-up: the official Google Identity Services button hands us an
  // ID token (credential), verified by the backend. Secure flow — no access
  // token in the browser.
  const handleGoogleSuccess = (credential: string) => {
    googleAuth(credential, {
      onSuccess: () => {
        navigate('/dashboard');
      },
    });
  };

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
          <h1 className="text-3xl font-heading font-bold text-slate-900 mb-2">
            {t('auth:register.createAccount', 'Create Account')}
          </h1>
          <p className="text-slate-600">
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

          <motion.div variants={itemVariants} className="grid grid-cols-2 gap-3">
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
            <Controller
              name="phone"
              control={control}
              defaultValue=""
              render={({ field }) => (
                <PhoneInput
                  label={t('auth:register.phone', 'Telefon')}
                  value={field.value || ''}
                  onChange={field.onChange}
                  error={errors.phone?.message}
                />
              )}
            />
          </motion.div>

          <motion.div variants={itemVariants}>
            <Controller
              name="countryCode"
              control={control}
              render={({ field }) => (
                <FormSelect
                  label={t('auth:register.country')}
                  hint={t(
                    'auth:register.countryHint',
                    "We suggest a country from your phone number — change it if it's wrong.",
                  )}
                  options={countryOptions}
                  error={errors.countryCode?.message}
                  value={field.value}
                  name={field.name}
                  onChange={(e) => {
                    // A manual pick is the operator's own choice — the
                    // phone-derived pre-fill effect above must never
                    // silently overwrite it again after this.
                    countryPinned.current = true;
                    field.onChange(e);
                  }}
                />
              )}
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
                placeholder={tenantsLoading ? t('common:app.loading') : t('auth:register.selectRestaurantPlaceholder')}
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
              onGoogleSuccess={handleGoogleSuccess}
              disabled={isPending || isGooglePending}
            />
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="text-center text-sm text-slate-600 pt-2"
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

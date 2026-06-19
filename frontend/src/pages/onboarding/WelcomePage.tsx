import { useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useProfile, useCompleteProfile } from '../../features/auth/authApi';
import { useLogout } from '../../features/auth/authApi';
import Input from '../../components/ui/Input';
import PhoneInput from '../../components/ui/PhoneInput';
import FormSelect from '../../components/ui/FormSelect';
import Button from '../../components/ui/Button';

const LANGUAGES = [
  { value: 'tr', label: 'Türkçe' },
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'العربية' },
  { value: 'ru', label: 'Русский' },
  { value: 'uz', label: 'Oʻzbekcha' },
];

const TIMEZONES = [
  { value: 'Europe/Istanbul', label: 'İstanbul (UTC+3)' },
  { value: 'Europe/London', label: 'London (UTC+0/+1)' },
  { value: 'UTC', label: 'UTC' },
];

/**
 * Post-social-login (and any incomplete-profile) onboarding. Collects the
 * required phone plus the business details we want up front (name, address,
 * tax info) and preferences (timezone, language), then drops the user into the
 * app. Reached via ProfileCompletionGate when the account has no phone yet.
 */
const WelcomePage = () => {
  const { t, i18n } = useTranslation(['auth', 'validation', 'common']);
  const navigate = useNavigate();
  const { data: profile } = useProfile();
  const { mutate: complete, isPending } = useCompleteProfile();
  const { mutate: logout } = useLogout();

  const schema = z.object({
    phone: z
      .string()
      .regex(
        /^\+[1-9]\d{6,14}$/,
        t('auth:profile.phoneInvalid', 'Lütfen geçerli bir telefon numarası girin.'),
      ),
    firstName: z.string().min(1, t('validation:required')),
    lastName: z.string().min(1, t('validation:required')),
    businessName: z.string().min(1, t('validation:required')),
    taxId: z.string().optional(),
    taxOffice: z.string().optional(),
    addressLine: z.string().optional(),
    city: z.string().optional(),
    timezone: z.string().optional(),
    locale: z.string().optional(),
  });
  type FormData = z.infer<typeof schema>;

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      phone: '',
      firstName: '',
      lastName: '',
      businessName: '',
      timezone: 'Europe/Istanbul',
      locale: i18n.language || 'tr',
    },
  });

  // Pre-fill name from the social profile once it loads.
  useEffect(() => {
    if (profile) {
      reset((prev) => ({
        ...prev,
        firstName: profile.firstName || prev.firstName,
        lastName: profile.lastName || prev.lastName,
        phone: profile.phone || prev.phone,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const onSubmit = (data: FormData) => {
    complete(data, {
      onSuccess: () => {
        if (data.locale && data.locale !== i18n.language) {
          i18n.changeLanguage(data.locale);
        }
        navigate('/dashboard', { replace: true });
      },
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg border border-slate-200 p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">
          {t('auth:welcome.title', 'Hesabını tamamla')}
        </h1>
        <p className="text-slate-600 mb-6 text-sm">
          {t(
            'auth:welcome.subtitle',
            'Başlamadan önce birkaç bilgiye ihtiyacımız var. Telefon, ödeme adımı için zorunludur.',
          )}
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Controller
            name="phone"
            control={control}
            render={({ field }) => (
              <PhoneInput
                label={`${t('auth:register.phone', 'Telefon')} *`}
                value={field.value || ''}
                onChange={field.onChange}
                error={errors.phone?.message}
              />
            )}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('auth:register.firstName', 'Ad')}
              error={errors.firstName?.message}
              {...register('firstName')}
            />
            <Input
              label={t('auth:register.lastName', 'Soyad')}
              error={errors.lastName?.message}
              {...register('lastName')}
            />
          </div>

          <Input
            label={`${t('auth:welcome.businessName', 'İşletme adı')} *`}
            placeholder={t('auth:welcome.businessNamePlaceholder', 'Restoranınızın adı')}
            error={errors.businessName?.message}
            {...register('businessName')}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('auth:welcome.taxId', 'Vergi No / TC Kimlik')}
              error={errors.taxId?.message}
              {...register('taxId')}
            />
            <Input
              label={t('auth:welcome.taxOffice', 'Vergi Dairesi')}
              error={errors.taxOffice?.message}
              {...register('taxOffice')}
            />
          </div>

          <Input
            label={t('auth:welcome.address', 'Adres')}
            error={errors.addressLine?.message}
            {...register('addressLine')}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('auth:welcome.city', 'Şehir')}
              error={errors.city?.message}
              {...register('city')}
            />
            <FormSelect
              label={t('auth:welcome.timezone', 'Saat dilimi')}
              options={TIMEZONES}
              error={errors.timezone?.message}
              {...register('timezone')}
            />
          </div>

          <FormSelect
            label={t('auth:welcome.language', 'Dil')}
            options={LANGUAGES}
            error={errors.locale?.message}
            {...register('locale')}
          />

          <Button type="submit" variant="primary" className="w-full" isLoading={isPending}>
            {t('auth:welcome.submit', 'Tamamla ve devam et')}
          </Button>

          <button
            type="button"
            onClick={() => logout()}
            className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
          >
            {t('auth:welcome.logout', 'Çıkış yap')}
          </button>
        </form>
      </div>
    </div>
  );
};

export default WelcomePage;

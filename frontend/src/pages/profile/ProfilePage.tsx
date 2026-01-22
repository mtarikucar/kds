import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useMyProfile, useUpdateProfile } from '../../features/users/usersApi';
import { useChangePassword } from '../../features/auth/authApi';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { EmailVerificationCard } from '../../components/EmailVerificationCard';
import { isValidPhone } from '../../utils/validation';
import {
  User,
  Mail,
  Phone,
  Shield,
  Lock,
  Building2,
  Calendar,
  Clock,
  CheckCircle,
  AlertCircle,
  Globe,
} from 'lucide-react';

const ProfilePage = () => {
  const { t } = useTranslation(['auth', 'validation']);

  const profileSchema = z.object({
    firstName: z.string().min(2, t('validation.firstNameMin')),
    lastName: z.string().min(2, t('validation.lastNameMin')),
    phone: z.string()
      .optional()
      .refine(
        (val) => !val || isValidPhone(val),
        { message: t('validation:invalidPhone') }
      )
      .or(z.literal('')),
  });

  type ProfileFormData = z.infer<typeof profileSchema>;

  const passwordSchema = z.object({
    currentPassword: z.string().min(8),
    newPassword: z.string().min(8, t('validation.passwordMin')),
    confirmPassword: z.string(),
  }).refine((data) => data.newPassword === data.confirmPassword, {
    message: t('validation.passwordsMatch'),
    path: ['confirmPassword'],
  });

  type PasswordFormData = z.infer<typeof passwordSchema>;
  const { data: profile, isLoading } = useMyProfile();
  const { mutate: updateProfile, isPending: isUpdating } = useUpdateProfile();
  const { mutate: changePassword, isPending: isChangingPassword } = useChangePassword();

  const {
    register: registerProfile,
    handleSubmit: handleProfileSubmit,
    formState: { errors: profileErrors },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    values: profile ? {
      firstName: profile.firstName,
      lastName: profile.lastName,
      phone: profile.phone || '',
    } : undefined,
  });

  const {
    register: registerPassword,
    handleSubmit: handlePasswordSubmit,
    formState: { errors: passwordErrors },
    reset: resetPassword,
  } = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
  });

  const onProfileSubmit = (data: ProfileFormData) => {
    updateProfile(data);
  };

  const onPasswordSubmit = (data: PasswordFormData) => {
    changePassword({
      oldPassword: data.currentPassword,
      newPassword: data.newPassword,
    }, {
      onSuccess: () => {
        resetPassword();
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-slate-600">{t('common:app.loading')}</div>
      </div>
    );
  }

  // Get initials for avatar
  const initials = profile ? `${profile.firstName[0]}${profile.lastName[0]}`.toUpperCase() : '';

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
          <User className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-heading font-bold text-slate-900">{t('profile.title')}</h1>
          <p className="text-slate-500 mt-0.5">{t('profile.manageYourAccount')}</p>
        </div>
      </div>

      {/* Profile Overview Card */}
      <div className="bg-white rounded-2xl border border-slate-200/60 p-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
          {/* Avatar */}
          <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white text-3xl font-bold shadow-lg shadow-primary-500/20">
            {initials}
          </div>

          {/* Info */}
          <div className="flex-1 text-center sm:text-left">
            <h2 className="text-xl font-semibold text-slate-900">
              {profile?.firstName} {profile?.lastName}
            </h2>
            <p className="text-slate-500 mt-1">{profile?.email}</p>

            {/* Status badges */}
            <div className="flex flex-wrap justify-center sm:justify-start gap-2 mt-3">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-primary-100 text-primary-800">
                <Shield className="w-3.5 h-3.5" />
                {profile?.role}
              </span>
              {profile?.emailVerified ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                  <CheckCircle className="w-3.5 h-3.5" />
                  {t('profile.emailVerified')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {t('profile.emailNotVerified')}
                </span>
              )}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="flex gap-4 sm:gap-6">
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-2">
                <Building2 className="w-5 h-5 text-slate-600" />
              </div>
              <p className="text-xs text-slate-500">{t('profile.restaurant')}</p>
              <p className="text-sm font-medium text-slate-900 truncate max-w-[100px]">{profile?.tenant?.name}</p>
            </div>
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-2">
                <Calendar className="w-5 h-5 text-slate-600" />
              </div>
              <p className="text-xs text-slate-500">{t('profile.memberSince')}</p>
              <p className="text-sm font-medium text-slate-900">{new Date(profile?.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Profile Information */}
        <div className="bg-white rounded-2xl border border-slate-200/60 p-6 hover:shadow-lg hover:border-primary-200 transition-all duration-300">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-primary-100 flex items-center justify-center">
              <User className="w-5 h-5 text-primary-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">{t('profile.personalInfo')}</h3>
          </div>

          <form onSubmit={handleProfileSubmit(onProfileSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label={t('profile.firstName')}
                placeholder={t('profile.firstNamePlaceholder')}
                error={profileErrors.firstName?.message}
                {...registerProfile('firstName')}
              />

              <Input
                label={t('profile.lastName')}
                placeholder={t('profile.lastNamePlaceholder')}
                error={profileErrors.lastName?.message}
                {...registerProfile('lastName')}
              />
            </div>

            <Input
              label={t('profile.email')}
              type="email"
              value={profile?.email}
              disabled
              helperText={t('profile.contactAdminEmail')}
            />

            <Input
              label={t('profile.phone')}
              placeholder={t('profile.phonePlaceholder')}
              error={profileErrors.phone?.message}
              {...registerProfile('phone')}
            />

            <Button type="submit" isLoading={isUpdating} className="w-full">
              {t('common:app.save')}
            </Button>
          </form>
        </div>

        {/* Change Password */}
        <div className="bg-white rounded-2xl border border-slate-200/60 p-6 hover:shadow-lg hover:border-primary-200 transition-all duration-300">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center">
              <Lock className="w-5 h-5 text-amber-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">{t('profile.changePassword')}</h3>
          </div>

          <form onSubmit={handlePasswordSubmit(onPasswordSubmit)} className="space-y-4">
            <Input
              label={t('profile.currentPassword')}
              type="password"
              placeholder={t('profile.enterCurrentPassword')}
              error={passwordErrors.currentPassword?.message}
              {...registerPassword('currentPassword')}
            />

            <Input
              label={t('profile.newPassword')}
              type="password"
              placeholder={t('profile.enterNewPassword')}
              error={passwordErrors.newPassword?.message}
              {...registerPassword('newPassword')}
            />

            <Input
              label={t('profile.confirmNewPassword')}
              type="password"
              placeholder={t('profile.confirmNewPassword')}
              error={passwordErrors.confirmPassword?.message}
              {...registerPassword('confirmPassword')}
            />

            <Button type="submit" isLoading={isChangingPassword} className="w-full">
              {t('profile.changePassword')}
            </Button>
          </form>
        </div>
      </div>

      {/* Email Verification */}
      {profile && !profile.emailVerified && (
        <EmailVerificationCard
          emailVerified={profile.emailVerified}
          userEmail={profile.email}
        />
      )}

      {/* Account Details */}
      <div className="bg-white rounded-2xl border border-slate-200/60 p-6 hover:shadow-lg hover:border-primary-200 transition-all duration-300">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-slate-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900">{t('profile.accountInformation')}</h3>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50">
            <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
              <Building2 className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">{t('profile.restaurant')}</p>
              <p className="text-sm font-medium text-slate-900">{profile?.tenant?.name}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50">
            <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
              <Globe className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">{t('profile.subdomain')}</p>
              <p className="text-sm font-medium text-slate-900 break-all">{profile?.tenant?.subdomain || '-'}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50">
            <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
              <Mail className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">{t('profile.email')}</p>
              <p className="text-sm font-medium text-slate-900 break-all">{profile?.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50">
            <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
              <Phone className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">{t('profile.phone')}</p>
              <p className="text-sm font-medium text-slate-900">{profile?.phone || '-'}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50">
            <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
              <Calendar className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">{t('profile.memberSince')}</p>
              <p className="text-sm font-medium text-slate-900">{new Date(profile?.createdAt).toLocaleDateString()}</p>
            </div>
          </div>

          {profile?.lastLogin && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50">
              <div className="w-10 h-10 rounded-lg bg-white flex items-center justify-center shadow-sm">
                <Clock className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-slate-500">{t('profile.lastLogin')}</p>
                <p className="text-sm font-medium text-slate-900">{new Date(profile.lastLogin).toLocaleString()}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { useMyProfile, useUpdateProfile } from '../../features/users/usersApi';
import { useChangePassword } from '../../features/auth/authApi';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';

const ProfilePage = () => {
  const { t } = useTranslation('auth');

  const profileSchema = z.object({
    firstName: z.string().min(2, t('validation.firstNameMin')),
    lastName: z.string().min(2, t('validation.lastNameMin')),
    phone: z.string().optional(),
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
        <div className="text-gray-600">{t('app:app.loading')}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-4xl">
      <h1 className="text-2xl md:text-3xl font-bold mb-4 md:mb-6">{t('profile.title')}</h1>

      <div className="grid gap-4 md:gap-6">
        {/* Profile Information */}
        <Card>
          <CardHeader>
            <CardTitle>{t('profile.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleProfileSubmit(onProfileSubmit)} className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <Input
                  label={t('profile.firstName')}
                  placeholder="John"
                  error={profileErrors.firstName?.message}
                  {...registerProfile('firstName')}
                />

                <Input
                  label={t('profile.lastName')}
                  placeholder="Doe"
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
                placeholder="+1234567890"
                error={profileErrors.phone?.message}
                {...registerProfile('phone')}
              />

              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs md:text-sm">
                <p className="text-blue-800 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-0">
                  <span><strong>{t('profile.role')}:</strong> {profile?.role}</span>
                  {profile?.emailVerified ? (
                    <span className="sm:ml-4 text-green-600">✓ {t('profile.emailVerified')}</span>
                  ) : (
                    <span className="sm:ml-4 text-orange-600">⚠ {t('profile.emailNotVerified')}</span>
                  )}
                </p>
              </div>

              <Button type="submit" isLoading={isUpdating}>
                {t('app:app.save')}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Change Password */}
        <Card>
          <CardHeader>
            <CardTitle>{t('profile.changePassword')}</CardTitle>
          </CardHeader>
          <CardContent>
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

              <Button type="submit" isLoading={isChangingPassword}>
                {t('profile.changePassword')}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Account Information */}
        <Card>
          <CardHeader>
            <CardTitle>{t('profile.accountInformation')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-xs md:text-sm text-gray-600">
              <p className="break-words"><strong>{t('profile.restaurant')}:</strong> {profile?.tenant?.name}</p>
              <p className="break-all"><strong>{t('profile.subdomain')}:</strong> {profile?.tenant?.subdomain}</p>
              <p><strong>{t('profile.memberSince')}:</strong> {new Date(profile?.createdAt).toLocaleDateString()}</p>
              {profile?.lastLogin && (
                <p><strong>{t('profile.lastLogin')}:</strong> {new Date(profile.lastLogin).toLocaleString()}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ProfilePage;

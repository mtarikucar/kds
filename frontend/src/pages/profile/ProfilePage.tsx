import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMyProfile, useUpdateProfile } from '../../features/users/usersApi';
import { useChangePassword } from '../../features/auth/authApi';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';

const profileSchema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  phone: z.string().optional(),
});

const passwordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type ProfileFormData = z.infer<typeof profileSchema>;
type PasswordFormData = z.infer<typeof passwordSchema>;

const ProfilePage = () => {
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
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-4xl">
      <h1 className="text-2xl md:text-3xl font-bold mb-4 md:mb-6">Profile Settings</h1>

      <div className="grid gap-4 md:gap-6">
        {/* Profile Information */}
        <Card>
          <CardHeader>
            <CardTitle>Profile Information</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleProfileSubmit(onProfileSubmit)} className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <Input
                  label="First Name"
                  placeholder="John"
                  error={profileErrors.firstName?.message}
                  {...registerProfile('firstName')}
                />

                <Input
                  label="Last Name"
                  placeholder="Doe"
                  error={profileErrors.lastName?.message}
                  {...registerProfile('lastName')}
                />
              </div>

              <Input
                label="Email"
                type="email"
                value={profile?.email}
                disabled
                helperText="Contact admin to change email"
              />

              <Input
                label="Phone"
                placeholder="+1234567890"
                error={profileErrors.phone?.message}
                {...registerProfile('phone')}
              />

              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-xs md:text-sm">
                <p className="text-blue-800 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-0">
                  <span><strong>Role:</strong> {profile?.role}</span>
                  {profile?.emailVerified ? (
                    <span className="sm:ml-4 text-green-600">✓ Email Verified</span>
                  ) : (
                    <span className="sm:ml-4 text-orange-600">⚠ Email Not Verified</span>
                  )}
                </p>
              </div>

              <Button type="submit" isLoading={isUpdating}>
                Save Changes
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Change Password */}
        <Card>
          <CardHeader>
            <CardTitle>Change Password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit(onPasswordSubmit)} className="space-y-4">
              <Input
                label="Current Password"
                type="password"
                placeholder="Enter current password"
                error={passwordErrors.currentPassword?.message}
                {...registerPassword('currentPassword')}
              />

              <Input
                label="New Password"
                type="password"
                placeholder="Enter new password"
                error={passwordErrors.newPassword?.message}
                {...registerPassword('newPassword')}
              />

              <Input
                label="Confirm New Password"
                type="password"
                placeholder="Confirm new password"
                error={passwordErrors.confirmPassword?.message}
                {...registerPassword('confirmPassword')}
              />

              <Button type="submit" isLoading={isChangingPassword}>
                Change Password
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Account Information */}
        <Card>
          <CardHeader>
            <CardTitle>Account Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-xs md:text-sm text-gray-600">
              <p className="break-words"><strong>Restaurant:</strong> {profile?.tenant?.name}</p>
              <p className="break-all"><strong>Subdomain:</strong> {profile?.tenant?.subdomain}</p>
              <p><strong>Member Since:</strong> {new Date(profile?.createdAt).toLocaleDateString()}</p>
              {profile?.lastLogin && (
                <p><strong>Last Login:</strong> {new Date(profile.lastLogin).toLocaleString()}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ProfilePage;

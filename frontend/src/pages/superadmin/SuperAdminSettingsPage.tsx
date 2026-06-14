import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSuperAdminAuthStore } from '../../store/superAdminAuthStore';
import { useSetup2FA, useEnable2FA } from '../../features/superadmin/api/superAdminApi';

export default function SuperAdminSettingsPage() {
  const { t } = useTranslation('superadmin');
  const { superAdmin } = useSuperAdminAuthStore();
  const [showSetup2FA, setShowSetup2FA] = useState(false);
  const [code, setCode] = useState('');
  const [qrData, setQrData] = useState<{ secret: string; qrCodeUrl: string } | null>(null);

  const { refetch: fetchSetup2FA, isLoading: setupLoading } = useSetup2FA();
  const enable2FAMutation = useEnable2FA();

  const handleSetup2FA = async () => {
    const result = await fetchSetup2FA();
    if (result.data) {
      setQrData(result.data);
      setShowSetup2FA(true);
    }
  };

  const handleEnable2FA = () => {
    enable2FAMutation.mutate(code, {
      onSuccess: () => {
        setShowSetup2FA(false);
        setQrData(null);
        setCode('');
        alert(t('settings.enabledSuccess'));
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('settings.title')}</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t('settings.subtitle')}
        </p>
      </div>

      {/* Profile Info */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">{t('settings.profile')}</h2>
        <dl className="space-y-3">
          <div className="flex justify-between">
            <dt className="text-gray-500 dark:text-gray-400">{t('settings.email')}</dt>
            <dd className="text-gray-900 dark:text-white">{superAdmin?.email}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500 dark:text-gray-400">{t('settings.name')}</dt>
            <dd className="text-gray-900 dark:text-white">
              {superAdmin?.firstName} {superAdmin?.lastName}
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500 dark:text-gray-400">{t('settings.status')}</dt>
            <dd className="text-gray-900 dark:text-white">{superAdmin?.status}</dd>
          </div>
        </dl>
      </div>

      {/* Security */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">{t('settings.security')}</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-white">{t('settings.twoFactorAuth')}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {superAdmin?.twoFactorEnabled
                  ? t('settings.twoFactorEnabled')
                  : t('settings.twoFactorDisabled')}
              </p>
            </div>
            {!superAdmin?.twoFactorEnabled && (
              <button
                onClick={handleSetup2FA}
                disabled={setupLoading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                {setupLoading ? t('settings.setup2faLoading') : t('settings.setup2fa')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2FA Setup Modal */}
      {showSetup2FA && qrData && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="fixed inset-0 bg-black/50" onClick={() => setShowSetup2FA(false)} />
            <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
                {t('settings.setupModalTitle')}
              </h2>

              <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('settings.setupModalIntro')}
                </p>

                <div className="flex justify-center">
                  <img src={qrData.qrCodeUrl} alt={t('settings.qrAlt')} className="w-48 h-48" />
                </div>

                <div className="bg-gray-100 dark:bg-gray-700 p-3 rounded-lg">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                    {t('settings.manualEntry')}
                  </p>
                  <code className="text-sm font-mono text-gray-900 dark:text-white break-all">
                    {qrData.secret}
                  </code>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('settings.verificationCode')}
                  </label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    maxLength={6}
                    placeholder="000000"
                    className="block w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-center text-xl tracking-widest"
                  />
                </div>

                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setShowSetup2FA(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    {t('settings.cancel')}
                  </button>
                  <button
                    onClick={handleEnable2FA}
                    disabled={code.length !== 6 || enable2FAMutation.isPending}
                    className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {enable2FAMutation.isPending ? t('settings.verifying') : t('settings.enable2fa')}
                  </button>
                </div>

                {enable2FAMutation.isError && (
                  <p className="text-sm text-red-500">
                    {(enable2FAMutation.error as any)?.response?.data?.message || t('settings.enableFailed')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

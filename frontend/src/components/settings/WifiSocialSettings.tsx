import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Wifi, Share2, Eye, EyeOff } from 'lucide-react';
import { useGetTenantSettings, useUpdateTenantSettings } from '../../hooks/useCurrency';
import { useAutoSave } from '../../hooks/useAutoSave';
import { toast } from 'sonner';
import { SettingsSection, SettingsDivider, SettingsGroup } from './SettingsSection';

// Social media icons
const InstagramIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
  </svg>
);

const FacebookIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

const TwitterIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const TikTokIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
  </svg>
);

const YouTubeIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
  </svg>
);

const WhatsAppIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

interface WifiSocialState {
  wifiSsid: string;
  wifiPassword: string;
  socialInstagram: string;
  socialFacebook: string;
  socialTwitter: string;
  socialTiktok: string;
  socialYoutube: string;
  socialWhatsapp: string;
}

interface SocialInputProps {
  icon: React.ReactNode;
  iconColor: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  maxLength?: number;
}

function SocialInput({
  icon,
  iconColor,
  label,
  value,
  onChange,
  placeholder,
  maxLength = 255,
}: SocialInputProps) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className={`flex-shrink-0 ${iconColor}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <label className="sr-only">{label}</label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
        />
      </div>
    </div>
  );
}

export default function WifiSocialSettings() {
  const { t } = useTranslation('settings');
  const { data: settings, isLoading } = useGetTenantSettings();
  const { mutateAsync: updateSettings } = useUpdateTenantSettings();

  const [showPassword, setShowPassword] = useState(false);

  const [formState, setFormState] = useState<WifiSocialState>({
    wifiSsid: '',
    wifiPassword: '',
    socialInstagram: '',
    socialFacebook: '',
    socialTwitter: '',
    socialTiktok: '',
    socialYoutube: '',
    socialWhatsapp: '',
  });

  // Load existing settings
  useEffect(() => {
    if (settings) {
      setFormState({
        wifiSsid: settings.wifiSsid || '',
        wifiPassword: settings.wifiPassword || '',
        socialInstagram: settings.socialInstagram || '',
        socialFacebook: settings.socialFacebook || '',
        socialTwitter: settings.socialTwitter || '',
        socialTiktok: settings.socialTiktok || '',
        socialYoutube: settings.socialYoutube || '',
        socialWhatsapp: settings.socialWhatsapp || '',
      });
    }
  }, [settings]);

  // Save function
  const saveSettings = useCallback(
    async (state: WifiSocialState) => {
      await updateSettings({
        wifiSsid: state.wifiSsid || undefined,
        wifiPassword: state.wifiPassword || undefined,
        socialInstagram: state.socialInstagram || undefined,
        socialFacebook: state.socialFacebook || undefined,
        socialTwitter: state.socialTwitter || undefined,
        socialTiktok: state.socialTiktok || undefined,
        socialYoutube: state.socialYoutube || undefined,
        socialWhatsapp: state.socialWhatsapp || undefined,
      });
    },
    [updateSettings]
  );

  // Auto-save hook
  const {
    status: autoSaveStatus,
    setValue: triggerAutoSave,
    retry: retryAutoSave,
  } = useAutoSave(formState, saveSettings, {
    debounceMs: 800,
    onSuccess: () => {
      toast.success(t('autoSave.savedSuccess'), { duration: 2000 });
    },
    onError: () => {
      toast.error(t('wifiSocialSettings.saveError'));
    },
  });

  // Handle field changes
  const handleChange = (field: keyof WifiSocialState, value: string) => {
    const newState = { ...formState, [field]: value };
    setFormState(newState);
    triggerAutoSave(newState);
  };

  if (isLoading) {
    return (
      <SettingsSection
        title={t('wifiSocialSettings.title')}
        icon={<Wifi className="w-4 h-4" />}
      >
        <p className="text-slate-500 text-center py-4">{t('common:app.loading')}</p>
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      title={t('wifiSocialSettings.title')}
      description={t('wifiSocialSettings.description')}
      icon={<Wifi className="w-4 h-4" />}
      saveStatus={autoSaveStatus}
      onRetry={retryAutoSave}
    >
      {/* WiFi Section */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Wifi className="w-4 h-4 text-slate-500" />
          <h4 className="text-sm font-medium text-slate-700">
            {t('wifiSocialSettings.wifiSection')}
          </h4>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          {t('wifiSocialSettings.wifiDescription')}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {t('wifiSocialSettings.ssid')}
            </label>
            <input
              type="text"
              value={formState.wifiSsid}
              onChange={(e) => handleChange('wifiSsid', e.target.value)}
              placeholder={t('wifiSocialSettings.ssidPlaceholder')}
              maxLength={64}
              className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              {t('wifiSocialSettings.password')}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={formState.wifiPassword}
                onChange={(e) => handleChange('wifiPassword', e.target.value)}
                placeholder={t('wifiSocialSettings.passwordPlaceholder')}
                maxLength={128}
                className="w-full px-3 py-1.5 pr-9 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-400 hover:text-slate-600"
                title={
                  showPassword
                    ? t('wifiSocialSettings.hidePassword')
                    : t('wifiSocialSettings.showPassword')
                }
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <SettingsDivider />

      {/* Social Media Section */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Share2 className="w-4 h-4 text-slate-500" />
          <h4 className="text-sm font-medium text-slate-700">
            {t('wifiSocialSettings.socialSection')}
          </h4>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          {t('wifiSocialSettings.socialDescription')}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
          <SocialInput
            icon={<InstagramIcon />}
            iconColor="text-pink-600"
            label={t('wifiSocialSettings.instagram')}
            value={formState.socialInstagram}
            onChange={(v) => handleChange('socialInstagram', v)}
            placeholder={t('wifiSocialSettings.instagramPlaceholder')}
          />
          <SocialInput
            icon={<FacebookIcon />}
            iconColor="text-blue-600"
            label={t('wifiSocialSettings.facebook')}
            value={formState.socialFacebook}
            onChange={(v) => handleChange('socialFacebook', v)}
            placeholder={t('wifiSocialSettings.facebookPlaceholder')}
          />
          <SocialInput
            icon={<TwitterIcon />}
            iconColor="text-slate-900"
            label={t('wifiSocialSettings.twitter')}
            value={formState.socialTwitter}
            onChange={(v) => handleChange('socialTwitter', v)}
            placeholder={t('wifiSocialSettings.twitterPlaceholder')}
          />
          <SocialInput
            icon={<TikTokIcon />}
            iconColor="text-slate-900"
            label={t('wifiSocialSettings.tiktok')}
            value={formState.socialTiktok}
            onChange={(v) => handleChange('socialTiktok', v)}
            placeholder={t('wifiSocialSettings.tiktokPlaceholder')}
          />
          <SocialInput
            icon={<YouTubeIcon />}
            iconColor="text-red-600"
            label={t('wifiSocialSettings.youtube')}
            value={formState.socialYoutube}
            onChange={(v) => handleChange('socialYoutube', v)}
            placeholder={t('wifiSocialSettings.youtubePlaceholder')}
          />
          <SocialInput
            icon={<WhatsAppIcon />}
            iconColor="text-green-600"
            label={t('wifiSocialSettings.whatsapp')}
            value={formState.socialWhatsapp}
            onChange={(v) => handleChange('socialWhatsapp', v)}
            placeholder={t('wifiSocialSettings.whatsappPlaceholder')}
            maxLength={20}
          />
        </div>
      </div>
    </SettingsSection>
  );
}

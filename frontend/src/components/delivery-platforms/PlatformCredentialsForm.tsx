import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';

interface CredentialField {
  key: string;
  label: string;
  type?: 'text' | 'password';
  placeholder?: string;
  required?: boolean;
}

const PLATFORM_FIELDS: Record<string, CredentialField[]> = {
  GETIR: [
    { key: 'appSecretKey', label: 'App Secret Key', type: 'password', required: true },
    { key: 'restaurantSecretKey', label: 'Restaurant Secret Key', type: 'password', required: true },
  ],
  YEMEKSEPETI: [
    { key: 'clientId', label: 'Client ID', type: 'text', required: true },
    { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true },
    { key: 'chainCode', label: 'Chain Code', type: 'text' },
    { key: 'posVendorId', label: 'POS Vendor ID', type: 'text' },
  ],
  TRENDYOL: [
    { key: 'apiVersion', label: 'API Version', type: 'text', placeholder: 'v1 or v2' },
    { key: 'username', label: 'Username', type: 'text' },
    { key: 'password', label: 'Password', type: 'password' },
    { key: 'integratorId', label: 'Integrator ID (v2)', type: 'text' },
    { key: 'integratorSecret', label: 'Integrator Secret (v2)', type: 'password' },
  ],
  MIGROS: [
    { key: 'apiKey', label: 'API Key', type: 'password', required: true },
  ],
};

interface PlatformCredentialsFormProps {
  platform: string;
  credentials: Record<string, any>;
  remoteRestaurantId: string;
  onChange: (credentials: Record<string, any>, remoteRestaurantId: string) => void;
  disabled?: boolean;
}

const PlatformCredentialsForm = ({
  platform,
  credentials,
  remoteRestaurantId,
  onChange,
  disabled,
}: PlatformCredentialsFormProps) => {
  const { t } = useTranslation('settings');
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const fields = PLATFORM_FIELDS[platform] || [];

  const handleChange = (key: string, value: string) => {
    onChange({ ...credentials, [key]: value }, remoteRestaurantId);
  };

  const togglePassword = (key: string) => {
    setShowPasswords((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          {t('onlineOrders.credentials.restaurantId')}
        </label>
        <input
          type="text"
          value={remoteRestaurantId}
          onChange={(e) => onChange(credentials, e.target.value)}
          placeholder={t('onlineOrders.credentials.restaurantIdPlaceholder')}
          disabled={disabled}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-slate-50 disabled:text-slate-400"
        />
      </div>

      {fields.map((field) => (
        <div key={field.key}>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {field.label}
            {field.required && <span className="text-red-500 ml-0.5">*</span>}
          </label>
          <div className="relative">
            <input
              type={
                field.type === 'password' && !showPasswords[field.key]
                  ? 'password'
                  : 'text'
              }
              value={credentials[field.key] || ''}
              onChange={(e) => handleChange(field.key, e.target.value)}
              placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
              disabled={disabled}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-slate-50 disabled:text-slate-400 pr-10"
            />
            {field.type === 'password' && (
              <button
                type="button"
                onClick={() => togglePassword(field.key)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {showPasswords[field.key] ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default PlatformCredentialsForm;

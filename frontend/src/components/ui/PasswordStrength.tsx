import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface PasswordStrengthProps {
  password: string;
  showRequirements?: boolean;
}

interface PasswordRequirement {
  key: string;
  label: string;
  test: (password: string) => boolean;
}

const PasswordStrength: React.FC<PasswordStrengthProps> = ({
  password,
  showRequirements = true,
}) => {
  const { t } = useTranslation(['auth']);

  const requirements: PasswordRequirement[] = useMemo(
    () => [
      {
        key: 'minLength',
        label: t('auth:passwordStrength.minLength', 'At least 8 characters'),
        test: (pwd) => pwd.length >= 8,
      },
      {
        key: 'uppercase',
        label: t('auth:passwordStrength.uppercase', 'One uppercase letter'),
        test: (pwd) => /[A-Z]/.test(pwd),
      },
      {
        key: 'lowercase',
        label: t('auth:passwordStrength.lowercase', 'One lowercase letter'),
        test: (pwd) => /[a-z]/.test(pwd),
      },
      {
        key: 'number',
        label: t('auth:passwordStrength.number', 'One number'),
        test: (pwd) => /[0-9]/.test(pwd),
      },
      {
        key: 'special',
        label: t('auth:passwordStrength.special', 'One special character'),
        test: (pwd) => /[!@#$%^&*(),.?":{}|<>]/.test(pwd),
      },
    ],
    [t]
  );

  const passedRequirements = useMemo(
    () => requirements.filter((req) => req.test(password)).length,
    [password, requirements]
  );

  const strength = useMemo(() => {
    if (!password) return { level: 0, label: '', color: '' };

    if (passedRequirements <= 1) {
      return { level: 1, label: t('auth:passwordStrength.weak', 'Weak'), color: 'bg-red-500' };
    }
    if (passedRequirements <= 2) {
      return { level: 2, label: t('auth:passwordStrength.fair', 'Fair'), color: 'bg-orange-500' };
    }
    if (passedRequirements <= 4) {
      return { level: 3, label: t('auth:passwordStrength.good', 'Good'), color: 'bg-yellow-500' };
    }
    return { level: 4, label: t('auth:passwordStrength.strong', 'Strong'), color: 'bg-green-500' };
  }, [password, passedRequirements, t]);

  if (!password) return null;

  return (
    <div className="mt-2 space-y-3">
      {/* Strength Bar */}
      <div className="space-y-1.5">
        <div className="flex gap-1">
          {[1, 2, 3, 4].map((level) => (
            <div
              key={level}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors duration-300',
                level <= strength.level ? strength.color : 'bg-gray-200'
              )}
            />
          ))}
        </div>
        <p className={cn(
          'text-xs font-medium transition-colors duration-300',
          strength.level === 1 && 'text-red-600',
          strength.level === 2 && 'text-orange-600',
          strength.level === 3 && 'text-yellow-600',
          strength.level === 4 && 'text-green-600'
        )}>
          {strength.label}
        </p>
      </div>

      {/* Requirements List */}
      {showRequirements && (
        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-xs font-medium text-gray-600 mb-2">
            {t('auth:passwordStrength.requirements', 'Password must contain:')}
          </p>
          <ul className="space-y-1">
            {requirements.map((req) => {
              const passed = req.test(password);
              return (
                <li
                  key={req.key}
                  className={cn(
                    'flex items-center gap-2 text-xs transition-colors duration-200',
                    passed ? 'text-green-600' : 'text-gray-500'
                  )}
                >
                  {passed ? (
                    <Check className="w-3.5 h-3.5 flex-shrink-0" />
                  ) : (
                    <X className="w-3.5 h-3.5 flex-shrink-0" />
                  )}
                  <span>{req.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

export { PasswordStrength };
export default PasswordStrength;

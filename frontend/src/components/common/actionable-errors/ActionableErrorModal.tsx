import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../ui/Modal';
import Input from '../../ui/Input';
import Button from '../../ui/Button';
import { useUpdateProfile } from '../../../features/users/usersApi';
import { getApiErrorMessage } from '../../../lib/api-error';
import type { ActionableErrorSpec } from './actionableErrors';

interface ActionableErrorModalProps {
  spec: ActionableErrorSpec;
  /** Close without fixing (Cancel / Esc / backdrop). */
  onCancel: () => void;
  /** Field persisted successfully → resume the original action. */
  onResolved: () => void;
}

/**
 * Single-field inline-fix modal. Collects the missing value the server asked
 * for, persists it (silently — this component owns all feedback), then calls
 * `onResolved` so the caller can re-run the original blocked action.
 *
 * All update hooks are instantiated unconditionally (Rules of Hooks) and
 * dispatched by `spec.field`; add a new `case` when adding a new field.
 */
const ActionableErrorModal = ({ spec, onCancel, onResolved }: ActionableErrorModalProps) => {
  const { t } = useTranslation('common');
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  // Silent: no built-in toasts — this modal shows inline feedback and resumes.
  const updateProfile = useUpdateProfile({ silent: true });
  const saving = updateProfile.isPending;

  const persist = (trimmed: string): Promise<unknown> => {
    switch (spec.field) {
      case 'phone':
        return updateProfile.mutateAsync({ phone: trimmed });
      default:
        // Exhaustiveness guard — a registered field with no persistence path
        // is a programming error, surfaced loudly rather than silently no-op.
        return Promise.reject(new Error(`No persistence path for field "${spec.field}"`));
    }
  };

  const handleSave = () => {
    const trimmed = value.trim();
    if (!spec.validate(trimmed)) {
      setFieldError(t(spec.invalidKey));
      return;
    }
    setFieldError(null);
    persist(trimmed)
      .then(() => onResolved())
      .catch((e) =>
        setFieldError(
          getApiErrorMessage(e, t('actionableErrors.saveFailed', 'Kaydedilemedi. Lütfen tekrar deneyin.')),
        ),
      );
  };

  return (
    <Modal isOpen title={t(spec.titleKey)} onClose={onCancel} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{t(spec.bodyKey)}</p>
        <Input
          label={t(spec.labelKey)}
          type={spec.inputType}
          inputMode={spec.field === 'phone' ? 'tel' : undefined}
          placeholder={spec.placeholder}
          value={value}
          autoFocus
          error={fieldError ?? undefined}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !saving) handleSave();
          }}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            {t('app.cancel', 'İptal')}
          </Button>
          <Button variant="primary" onClick={handleSave} isLoading={saving}>
            {t('actionableErrors.saveAndContinue', 'Kaydet ve devam et')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ActionableErrorModal;

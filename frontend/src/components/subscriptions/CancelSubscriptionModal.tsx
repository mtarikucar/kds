import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { AlertTriangle } from 'lucide-react';

interface CancelSubscriptionModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (params: { immediate: boolean; reason: string }) => void;
  isSubmitting?: boolean;
  /** End-of-period date shown in the warning copy. */
  periodEnd?: Date | null;
}

const REASONS_KEY = [
  'tooExpensive',
  'missingFeature',
  'switchedProvider',
  'temporary',
  'other',
] as const;

type ReasonKey = (typeof REASONS_KEY)[number];

/**
 * Cancellation flow with multi-choice "neden ayrılıyorsunuz?" + optional
 * free-text. The reason maps to `Subscription.cancellationReason` on the
 * backend so retention analytics see the structured signal, not raw
 * free-text typed by the user.
 */
export default function CancelSubscriptionModal({
  open,
  onClose,
  onConfirm,
  isSubmitting = false,
  periodEnd,
}: CancelSubscriptionModalProps) {
  const { t } = useTranslation('subscriptions');
  const [reasonKey, setReasonKey] = useState<ReasonKey | null>(null);
  const [otherText, setOtherText] = useState('');
  const [immediate, setImmediate] = useState(false);

  const reasonText =
    reasonKey === 'other'
      ? otherText.trim()
      : reasonKey
        ? t(`subscriptions.cancelModal.reasons.${reasonKey}`)
        : '';
  const canSubmit = !!reasonKey && (reasonKey !== 'other' || otherText.trim().length > 0);

  return (
    <Modal isOpen={open} onClose={onClose} title={t('subscriptions.cancelModal.title')}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-900">
            {immediate
              ? t('subscriptions.cancelModal.warnImmediate')
              : t('subscriptions.cancelModal.warnPeriodEnd', {
                  date: periodEnd ? periodEnd.toLocaleDateString('tr-TR') : '',
                })}
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700 mb-2">
            {t('subscriptions.cancelModal.reasonPrompt')}
          </legend>
          {REASONS_KEY.map((key) => (
            <label
              key={key}
              className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition-colors ${
                reasonKey === key
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <input
                type="radio"
                name="cancel-reason"
                checked={reasonKey === key}
                onChange={() => setReasonKey(key)}
                className="w-4 h-4 text-blue-600"
              />
              <span className="text-sm text-slate-800">
                {t(`subscriptions.cancelModal.reasons.${key}`)}
              </span>
            </label>
          ))}
        </fieldset>

        {reasonKey === 'other' && (
          <textarea
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            maxLength={500}
            placeholder={t('subscriptions.cancelModal.otherPlaceholder')}
            className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
            rows={3}
          />
        )}

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={immediate}
            onChange={(e) => setImmediate(e.target.checked)}
            className="w-4 h-4"
          />
          {t('subscriptions.cancelModal.immediate')}
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t('subscriptions.cancelModal.keep')}
          </Button>
          <Button
            variant="danger"
            onClick={() => onConfirm({ immediate, reason: reasonText })}
            disabled={!canSubmit || isSubmitting}
            isLoading={isSubmitting}
          >
            {t('subscriptions.cancelModal.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

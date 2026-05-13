import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { Receipt } from 'lucide-react';

interface TaxIdReminderModalProps {
  open: boolean;
  onContinue: () => void;
  onSkip: () => void;
}

/**
 * Pre-payment nudge for tenants without a Vergi No / TC Kimlik on file.
 * KDV-compliant invoices need the tax ID embedded — without it, the
 * invoice PDF prints incomplete. The modal offers two paths: "fill now"
 * (jump to Branding settings) or "skip" (proceed anyway).
 */
export default function TaxIdReminderModal({
  open,
  onContinue,
  onSkip,
}: TaxIdReminderModalProps) {
  const { t } = useTranslation('subscriptions');
  const navigate = useNavigate();

  return (
    <Modal isOpen={open} onClose={onSkip} title={t('subscriptions.taxIdReminder.title')}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
          <Receipt className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-indigo-900">
            {t('subscriptions.taxIdReminder.body')}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onContinue}>
            {t('subscriptions.taxIdReminder.skip')}
          </Button>
          <Button
            variant="primary"
            onClick={() => navigate('/admin/settings/branding')}
          >
            {t('subscriptions.taxIdReminder.fillNow')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

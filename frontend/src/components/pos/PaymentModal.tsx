import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Select from '../ui/Select';
import Input from '../ui/Input';
import { PaymentMethod } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { useTranslation } from 'react-i18next';

const paymentSchema = z.object({
  method: z.nativeEnum(PaymentMethod),
  transactionId: z.string().optional(),
  customerPhone: z.string().optional(),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

export type { PaymentFormData };

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  total: number;
  onConfirm: (data: PaymentFormData) => void;
  isLoading?: boolean;
}

const PaymentModal = ({
  isOpen,
  onClose,
  total,
  onConfirm,
  isLoading = false,
}: PaymentModalProps) => {
  const { t } = useTranslation('pos');
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      method: PaymentMethod.CASH,
    },
  });

  const paymentMethod = watch('method');

  const paymentMethodOptions = [
    { value: PaymentMethod.CASH, label: t('payment.methods.cash') },
    { value: PaymentMethod.CARD, label: t('payment.methods.card') },
    { value: PaymentMethod.DIGITAL, label: t('payment.methods.digital') },
  ];

  const onSubmit = (data: PaymentFormData) => {
    onConfirm(data);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('payment.title')} size="md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="bg-blue-50 p-4 rounded-lg text-center">
          <p className="text-sm text-gray-600 mb-1">{t('payment.totalAmount')}</p>
          <p className="text-3xl font-bold text-blue-600">
            {formatCurrency(total)}
          </p>
        </div>

        <Input
          label={t('payment.customerPhone')}
          placeholder={t('payment.customerPhonePlaceholder')}
          type="tel"
          error={errors.customerPhone?.message}
          {...register('customerPhone')}
        />

        <Select
          label={t('payment.method')}
          options={paymentMethodOptions}
          error={errors.method?.message}
          {...register('method')}
        />

        {(paymentMethod === PaymentMethod.CARD ||
          paymentMethod === PaymentMethod.DIGITAL) && (
          <Input
            label={t('payment.transactionIdLabel')}
            placeholder={t('payment.transactionIdPlaceholder')}
            error={errors.transactionId?.message}
            {...register('transactionId')}
          />
        )}

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onClose}
          >
            {t('common:app.cancel')}
          </Button>
          <Button
            type="submit"
            variant="success"
            className="flex-1"
            isLoading={isLoading}
          >
            {t('payment.confirmPayment')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default PaymentModal;

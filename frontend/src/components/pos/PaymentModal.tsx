import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Select from '../ui/Select';
import Input from '../ui/Input';
import { PaymentMethod } from '../../types';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { useTranslation } from 'react-i18next';
import { isValidPhone } from '../../utils/validation';
import { CreditCard, Banknote, Smartphone } from 'lucide-react';

const createPaymentSchema = (t: (key: string) => string) => z.object({
  method: z.nativeEnum(PaymentMethod),
  transactionId: z.string().optional(),
  customerPhone: z.string()
    .optional()
    .refine(
      (val) => !val || isValidPhone(val),
      { message: t('validation:invalidPhone') }
    )
    .or(z.literal('')),
});

type PaymentFormData = z.infer<ReturnType<typeof createPaymentSchema>>;

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
  const { t } = useTranslation(['pos', 'validation']);
  const formatPrice = useFormatCurrency();
  const paymentSchema = createPaymentSchema(t);
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

  const getPaymentIcon = (method: PaymentMethod) => {
    switch (method) {
      case PaymentMethod.CASH:
        return <Banknote className="h-5 w-5" />;
      case PaymentMethod.CARD:
        return <CreditCard className="h-5 w-5" />;
      case PaymentMethod.DIGITAL:
        return <Smartphone className="h-5 w-5" />;
      default:
        return null;
    }
  };

  const onSubmit = (data: PaymentFormData) => {
    onConfirm(data);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('payment.title')} size="sm">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Total Amount Card */}
        <div className="bg-gradient-to-br from-primary-50 to-primary-100/50 p-5 rounded-xl border border-primary-200/60 text-center">
          <p className="text-sm text-slate-600 mb-1">{t('payment.totalAmount')}</p>
          <p className="text-3xl font-bold text-primary-600">
            {formatPrice(total)}
          </p>
        </div>

        <Input
          label={t('payment.customerPhone')}
          placeholder={t('payment.customerPhonePlaceholder')}
          type="tel"
          error={errors.customerPhone?.message}
          {...register('customerPhone')}
        />

        {/* Payment Method Selection */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">
            {t('payment.method')}
          </label>
          <div className="grid grid-cols-3 gap-3">
            {paymentMethodOptions.map((option) => (
              <label
                key={option.value}
                className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                  paymentMethod === option.value
                    ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-500/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <input
                  type="radio"
                  value={option.value}
                  {...register('method')}
                  className="sr-only"
                />
                <div className={`p-2 rounded-lg ${
                  paymentMethod === option.value ? 'bg-primary-100 text-primary-600' : 'bg-slate-100 text-slate-500'
                }`}>
                  {getPaymentIcon(option.value)}
                </div>
                <span className={`text-sm font-medium ${
                  paymentMethod === option.value ? 'text-primary-700' : 'text-slate-600'
                }`}>
                  {option.label}
                </span>
              </label>
            ))}
          </div>
          {errors.method && (
            <p className="mt-1.5 text-sm text-red-600">{errors.method.message}</p>
          )}
        </div>

        {(paymentMethod === PaymentMethod.CARD ||
          paymentMethod === PaymentMethod.DIGITAL) && (
          <Input
            label={t('payment.transactionIdLabel')}
            placeholder={t('payment.transactionIdPlaceholder')}
            error={errors.transactionId?.message}
            {...register('transactionId')}
          />
        )}

        <div className="flex gap-3 pt-2">
          <Button
            type="button"
            variant="secondary"
            className="flex-1"
            onClick={onClose}
          >
            {t('common:app.cancel')}
          </Button>
          <Button
            type="submit"
            variant="primary"
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

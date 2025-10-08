import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Select from '../ui/Select';
import Input from '../ui/Input';
import { PaymentMethod } from '../../types';
import { formatCurrency } from '../../lib/utils';

const paymentSchema = z.object({
  method: z.nativeEnum(PaymentMethod),
  transactionId: z.string().optional(),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

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
    { value: PaymentMethod.CASH, label: 'Cash' },
    { value: PaymentMethod.CARD, label: 'Card' },
    { value: PaymentMethod.DIGITAL, label: 'Digital Payment' },
  ];

  const onSubmit = (data: PaymentFormData) => {
    onConfirm(data);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Payment" size="md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div className="bg-blue-50 p-4 rounded-lg text-center">
          <p className="text-sm text-gray-600 mb-1">Total Amount</p>
          <p className="text-3xl font-bold text-blue-600">
            {formatCurrency(total)}
          </p>
        </div>

        <Select
          label="Payment Method"
          options={paymentMethodOptions}
          error={errors.method?.message}
          {...register('method')}
        />

        {(paymentMethod === PaymentMethod.CARD ||
          paymentMethod === PaymentMethod.DIGITAL) && (
          <Input
            label="Transaction ID (Optional)"
            placeholder="Enter transaction ID"
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
            Cancel
          </Button>
          <Button
            type="submit"
            variant="success"
            className="flex-1"
            isLoading={isLoading}
          >
            Confirm Payment
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default PaymentModal;

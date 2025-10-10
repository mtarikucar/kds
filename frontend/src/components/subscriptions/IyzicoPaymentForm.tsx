import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CreditCard, Loader2 } from 'lucide-react';

const paymentSchema = z.object({
  cardHolderName: z.string().min(3, 'Card holder name is required'),
  cardNumber: z
    .string()
    .regex(/^\d{16}$/, 'Card number must be 16 digits')
    .transform((val) => val.replace(/\s/g, '')),
  expireMonth: z
    .string()
    .regex(/^(0[1-9]|1[0-2])$/, 'Invalid month (01-12)'),
  expireYear: z
    .string()
    .regex(/^\d{4}$/, 'Invalid year (YYYY)')
    .refine((val) => parseInt(val) >= new Date().getFullYear(), 'Card expired'),
  cvc: z.string().regex(/^\d{3,4}$/, 'CVC must be 3-4 digits'),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

interface IyzicoPaymentFormProps {
  onSubmit: (data: PaymentFormData) => Promise<void>;
  amount: number;
  currency: string;
  isProcessing?: boolean;
}

export function IyzicoPaymentForm({
  onSubmit,
  amount,
  currency,
  isProcessing = false,
}: IyzicoPaymentFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
  });

  const [cardNumber, setCardNumber] = useState('');

  const formatCardNumber = (value: string) => {
    const cleaned = value.replace(/\s/g, '');
    const formatted = cleaned.match(/.{1,4}/g)?.join(' ') || cleaned;
    return formatted;
  };

  const handleCardNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCardNumber(e.target.value);
    setCardNumber(formatted);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-6">
          <CreditCard className="w-5 h-5 text-indigo-600" />
          <h3 className="text-lg font-semibold text-gray-900">
            Kart Bilgileri
          </h3>
        </div>

        <div className="space-y-4">
          {/* Card Holder Name */}
          <div>
            <label
              htmlFor="cardHolderName"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Kart Üzerindeki İsim
            </label>
            <input
              {...register('cardHolderName')}
              type="text"
              id="cardHolderName"
              placeholder="JOHN DOE"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 uppercase"
            />
            {errors.cardHolderName && (
              <p className="mt-1 text-sm text-red-600">
                {errors.cardHolderName.message}
              </p>
            )}
          </div>

          {/* Card Number */}
          <div>
            <label
              htmlFor="cardNumber"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Kart Numarası
            </label>
            <input
              {...register('cardNumber')}
              type="text"
              id="cardNumber"
              placeholder="1234 5678 9012 3456"
              maxLength={19}
              value={cardNumber}
              onChange={handleCardNumberChange}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
            />
            {errors.cardNumber && (
              <p className="mt-1 text-sm text-red-600">
                {errors.cardNumber.message}
              </p>
            )}
          </div>

          {/* Expiry and CVC */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="expireMonth"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Ay
              </label>
              <input
                {...register('expireMonth')}
                type="text"
                id="expireMonth"
                placeholder="MM"
                maxLength={2}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              {errors.expireMonth && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.expireMonth.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="expireYear"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Yıl
              </label>
              <input
                {...register('expireYear')}
                type="text"
                id="expireYear"
                placeholder="YYYY"
                maxLength={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              {errors.expireYear && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.expireYear.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="cvc"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                CVC
              </label>
              <input
                {...register('cvc')}
                type="text"
                id="cvc"
                placeholder="123"
                maxLength={4}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
              />
              {errors.cvc && (
                <p className="mt-1 text-sm text-red-600">{errors.cvc.message}</p>
              )}
            </div>
          </div>

          {/* Test Card Info */}
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-xs text-blue-800 font-medium mb-1">
              Test Kartı:
            </p>
            <p className="text-xs text-blue-700">
              5528 7900 0000 0001 | 12/2030 | CVC: 123
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
        <div>
          <p className="text-sm text-gray-600">Toplam Tutar</p>
          <p className="text-2xl font-bold text-gray-900">
            {currency} {amount.toFixed(2)}
          </p>
        </div>
        <button
          type="submit"
          disabled={isProcessing}
          className="px-8 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-semibold"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              İşleniyor...
            </>
          ) : (
            'Ödemeyi Tamamla'
          )}
        </button>
      </div>
    </form>
  );
}

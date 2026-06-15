import { useState, useEffect, useMemo } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Input from '../ui/Input';
import PhoneInput from '../ui/PhoneInput';
import NumericKeypad from './NumericKeypad';
import { PaymentMethod } from '../../types';
import { useFormatCurrency } from '../../hooks/useFormatCurrency';
import { useTranslation } from 'react-i18next';
import { CreditCard, Banknote, Smartphone } from 'lucide-react';
import { computeChangeDue, isTenderSufficient } from '../../pages/pos/posCart';

// `customerPhone` is now fed by <PhoneInput>, which only ever emits a canonical
// E.164 string (or '' while incomplete), so it's valid by construction — no
// format refinement needed here.
const createPaymentSchema = () => z.object({
  method: z.nativeEnum(PaymentMethod),
  transactionId: z.string().optional(),
  customerPhone: z.string().optional().or(z.literal('')),
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
  const paymentSchema = createPaymentSchema();
  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors },
  } = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      method: PaymentMethod.CASH,
    },
  });

  const paymentMethod = watch('method');

  // Cash-tender entry ("alınan tutar"). Kept as a raw string so the keypad can
  // drive it directly; parsed to a number for the change-due math.
  const [tenderedRaw, setTenderedRaw] = useState('');
  const tendered = parseFloat(tenderedRaw) || 0;
  const isCash = paymentMethod === PaymentMethod.CASH;

  // Reset the tendered amount whenever the modal (re)opens or the method
  // switches away from cash, so a stale value never carries into a new sale.
  useEffect(() => {
    if (!isOpen || !isCash) setTenderedRaw('');
  }, [isOpen, isCash]);

  const changeDue = useMemo(
    () => computeChangeDue(total, tendered),
    [total, tendered],
  );
  const tenderEntered = tenderedRaw !== '';
  const tenderSufficient = isTenderSufficient(total, tendered);
  // Block confirm only once the cashier has started entering an (insufficient)
  // amount — an untouched field shouldn't disable the button on open.
  const cashBlocked = isCash && tenderEntered && !tenderSufficient;

  // Quick-cash chips: "exact" plus the next round notes above the total.
  const quickCashOptions = useMemo(() => {
    const rounds = [50, 100, 200, 500];
    const ups = rounds.filter((r) => r >= total).slice(0, 3);
    return ups;
  }, [total]);

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

        <Controller
          name="customerPhone"
          control={control}
          render={({ field, fieldState }) => (
            <PhoneInput
              value={field.value ?? ''}
              onChange={field.onChange}
              label={t('payment.customerPhone')}
              error={fieldState.error?.message}
              defaultCountry="TR"
            />
          )}
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

        {/* CASH: amount-tendered keypad + auto change-due */}
        {isCash && (
          <div className="space-y-3">
            {/* Amount tendered display */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">
                {t('payment.amountTendered', 'Alınan Tutar')}
              </label>
              <div className="flex items-center justify-between px-4 py-3 rounded-xl border-2 border-slate-200 bg-white">
                <span className="text-sm text-slate-500">
                  {t('payment.methods.cash')}
                </span>
                <span className="text-2xl font-bold text-slate-900 tabular-nums">
                  {tenderEntered ? formatPrice(tendered) : formatPrice(0)}
                </span>
              </div>
            </div>

            {/* Quick-cash chips */}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTenderedRaw(String(total))}
                className="px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-semibold bg-primary-50 text-primary-700 border border-primary-200 hover:bg-primary-100 transition-colors active:scale-95"
              >
                {t('payment.exactAmount', 'Tam')}
              </button>
              {quickCashOptions.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => setTenderedRaw(String(amount))}
                  className="px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-semibold bg-white text-slate-700 border border-slate-200 hover:border-primary-300 hover:bg-primary-50/50 transition-colors active:scale-95"
                >
                  {formatPrice(amount)}
                </button>
              ))}
            </div>

            {/* Keypad */}
            <NumericKeypad
              value={tenderedRaw}
              onChange={setTenderedRaw}
              ariaLabel={t('payment.amountTendered', 'Alınan Tutar')}
            />

            {/* Change due ("Para üstü") */}
            <div
              className={`flex items-center justify-between p-4 rounded-xl border ${
                cashBlocked
                  ? 'bg-red-50 border-red-200'
                  : 'bg-emerald-50 border-emerald-200'
              }`}
            >
              <span
                className={`text-sm font-medium ${
                  cashBlocked ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                {cashBlocked
                  ? t('payment.insufficientCash', 'Tutar yetersiz')
                  : t('payment.changeDue', 'Para üstü')}
              </span>
              <span
                className={`text-2xl font-bold tabular-nums ${
                  cashBlocked ? 'text-red-600' : 'text-emerald-600'
                }`}
              >
                {formatPrice(changeDue)}
              </span>
            </div>
          </div>
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
            // Belt-and-suspenders: Button's own `isLoading` already
            // shows a spinner, but Button doesn't disable on its own —
            // a double-tap on touch screens would fire two submits
            // and the backend dedupes via idempotency key, but the
            // second call still consumes a slot in the throttler.
            // Cash sales are additionally blocked while the tendered amount
            // is insufficient (tendered < total) so we never confirm a
            // payment that can't cover the bill.
            disabled={isLoading || cashBlocked}
          >
            {t('payment.confirmPayment')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default PaymentModal;

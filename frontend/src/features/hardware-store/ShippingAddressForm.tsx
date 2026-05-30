import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ShippingAddress } from './storeApi';

/**
 * v2.8.84 — shipping address form for the hardware checkout flow.
 *
 * Field shape mirrors what the backend's `formatAddress` helper
 * (CheckoutNotificationsService) renders into the order-placed email —
 * keep them in sync so the email always reflects what the buyer typed.
 *
 * Validation is intentionally lenient on city/district punctuation
 * (Turkish addresses use a mix of Latin + Turkish characters; an overly
 * strict regex would lock out valid addresses).
 */

const phoneRegex = /^[+()\d\s-]{6,32}$/;

const schema = z.object({
  recipientName: z.string().min(2, 'Alıcı adı en az 2 karakter olmalı').max(80),
  phone: z
    .string()
    .min(6, 'Geçerli bir telefon numarası giriniz')
    .max(32)
    .regex(phoneRegex, 'Telefon numarası rakam, boşluk, +, -, ( ) içerebilir'),
  line1: z.string().min(3, 'Açık adres en az 3 karakter olmalı').max(160),
  line2: z.string().max(160).optional().or(z.literal('')),
  district: z.string().max(80).optional().or(z.literal('')),
  city: z.string().min(2, 'Şehir gerekli').max(80),
  postalCode: z
    .string()
    .max(16)
    .regex(/^[A-Za-z0-9\s-]*$/, 'Posta kodu geçersiz')
    .optional()
    .or(z.literal('')),
  country: z.string().min(2).max(64).default('Türkiye'),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  initial?: Partial<ShippingAddress>;
  onSubmit: (address: ShippingAddress) => void;
  submitting?: boolean;
  submitLabel?: string;
}

export default function ShippingAddressForm({
  initial,
  onSubmit,
  submitting,
  submitLabel = 'Devam et',
}: Props) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      recipientName: initial?.recipientName ?? '',
      phone: initial?.phone ?? '',
      line1: initial?.line1 ?? '',
      line2: initial?.line2 ?? '',
      district: initial?.district ?? '',
      city: initial?.city ?? '',
      postalCode: initial?.postalCode ?? '',
      country: initial?.country ?? 'Türkiye',
    },
  });

  return (
    <form
      onSubmit={handleSubmit((v) => {
        // Strip empty optional strings before handing back so the JSON
        // column doesn't carry "" entries.
        const cleaned: ShippingAddress = {
          recipientName: v.recipientName.trim(),
          phone: v.phone.trim(),
          line1: v.line1.trim(),
          line2: v.line2?.trim() || undefined,
          district: v.district?.trim() || undefined,
          city: v.city.trim(),
          postalCode: v.postalCode?.trim() || undefined,
          country: v.country.trim(),
        };
        onSubmit(cleaned);
      })}
      className="space-y-3"
    >
      <Field label="Alıcı adı" error={errors.recipientName?.message}>
        <input
          type="text"
          autoComplete="name"
          {...register('recipientName')}
          className="w-full rounded border px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Telefon" error={errors.phone?.message}>
        <input
          type="tel"
          autoComplete="tel"
          placeholder="+90 555 123 45 67"
          {...register('phone')}
          className="w-full rounded border px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Adres satırı 1" error={errors.line1?.message}>
        <input
          type="text"
          autoComplete="address-line1"
          {...register('line1')}
          className="w-full rounded border px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Adres satırı 2 (opsiyonel)" error={errors.line2?.message}>
        <input
          type="text"
          autoComplete="address-line2"
          {...register('line2')}
          className="w-full rounded border px-3 py-2 text-sm"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Şehir" error={errors.city?.message}>
          <input
            type="text"
            autoComplete="address-level2"
            {...register('city')}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </Field>
        <Field label="İlçe (opsiyonel)" error={errors.district?.message}>
          <input
            type="text"
            autoComplete="address-level3"
            {...register('district')}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Posta kodu (opsiyonel)" error={errors.postalCode?.message}>
          <input
            type="text"
            autoComplete="postal-code"
            {...register('postalCode')}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Ülke" error={errors.country?.message}>
          <input
            type="text"
            autoComplete="country-name"
            {...register('country')}
            className="w-full rounded border px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'İşleniyor…' : submitLabel}
      </button>
    </form>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-gray-700">{label}</span>
      {children}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}

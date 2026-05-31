import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { ShippingAddress } from './storeApi';
import type { Branch } from '../branches/branchesApi';

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
 *
 * v2.8.99.3 — "Ship to my branch" mode. The parent passes the tenant's
 * branches via `branches`; when at least one ACTIVE branch exists the
 * form defaults to branch mode and prefills the address fields
 * readonly from the selected branch. The buyer still fills
 * `recipientName` + `phone` because `Branch.address` carries neither
 * (no phone column on Branch, and the recipient is order-specific).
 * A radio toggles to "Yeni adres" (manual) which restores the
 * pre-v2.8.99.3 behaviour.
 *
 * onSubmit receives `{ address, branchId }` so the caller can fold
 * branchId into the top-level checkout intent payload while
 * `address` lands inside `cart.shippingAddress` as the snapshot.
 */

const phoneRegex = /^[+()\d\s-]{6,32}$/;

// v2.8.99.3 — line1 / city / country are required in custom mode but
// not rendered in branch mode (they come from the selected branch
// snapshot). Conditional required-ness via `superRefine` keyed on a
// hidden `mode` field. zod's discriminatedUnion would also work but
// superRefine plays nicer with react-hook-form's single
// defaultValues object.
const schema = z
  .object({
    mode: z.enum(['branch', 'custom']),
    recipientName: z.string().min(2, 'Alıcı adı en az 2 karakter olmalı').max(80),
    phone: z
      .string()
      .min(6, 'Geçerli bir telefon numarası giriniz')
      .max(32)
      .regex(phoneRegex, 'Telefon numarası rakam, boşluk, +, -, ( ) içerebilir'),
    line1: z.string().max(160).optional().or(z.literal('')),
    line2: z.string().max(160).optional().or(z.literal('')),
    district: z.string().max(80).optional().or(z.literal('')),
    city: z.string().max(80).optional().or(z.literal('')),
    postalCode: z
      .string()
      .max(16)
      .regex(/^[A-Za-z0-9\s-]*$/, 'Posta kodu geçersiz')
      .optional()
      .or(z.literal('')),
    country: z.string().max(64).optional().or(z.literal('')),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'custom') {
      if (!v.line1 || v.line1.length < 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['line1'],
          message: 'Açık adres en az 3 karakter olmalı',
        });
      }
      if (!v.city || v.city.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['city'],
          message: 'Şehir gerekli',
        });
      }
      if (!v.country || v.country.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['country'],
          message: 'Ülke gerekli',
        });
      }
    }
  });

type FormValues = z.infer<typeof schema>;

interface Props {
  initial?: Partial<ShippingAddress>;
  branches?: Branch[];
  onSubmit: (result: { address: ShippingAddress; branchId?: string }) => void;
  submitting?: boolean;
  submitLabel?: string;
}

type Mode = 'branch' | 'custom';

/**
 * Pull a free-form Branch.address Json blob into the form's
 * ShippingAddress shape. Tolerant of missing keys (Branch.address is
 * intentionally unvalidated in the schema — the multi-country chain
 * feature will tighten this later) — falls back to empty strings so
 * the readonly preview at least renders without nulls.
 */
function branchAddressToShipping(b: Branch): Partial<ShippingAddress> {
  const addr = (b.address ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof addr[k] === 'string' ? (addr[k] as string) : '');
  return {
    line1: str('line1'),
    line2: str('line2') || undefined,
    district: str('district') || undefined,
    city: str('city'),
    postalCode: str('postalCode') || undefined,
    country: str('country') || 'Türkiye',
  };
}

export default function ShippingAddressForm({
  initial,
  branches,
  onSubmit,
  submitting,
  submitLabel = 'Devam et',
}: Props) {
  const activeBranches = useMemo(
    () => (branches ?? []).filter((b) => b.status === 'active'),
    [branches],
  );

  // Mode default: branch when we have at least one active branch,
  // custom otherwise. The radio is hidden entirely when there are zero
  // branches so the form behaves identically to pre-v2.8.99.3.
  const [mode, setMode] = useState<Mode>(activeBranches.length > 0 ? 'branch' : 'custom');
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    activeBranches[0]?.id ?? '',
  );

  // Re-derive defaults when the active-branches list changes (parent
  // hook may settle from undefined → loaded).
  useEffect(() => {
    if (activeBranches.length === 0) {
      setMode('custom');
      setSelectedBranchId('');
    } else if (!selectedBranchId || !activeBranches.find((b) => b.id === selectedBranchId)) {
      setSelectedBranchId(activeBranches[0].id);
    }
  }, [activeBranches, selectedBranchId]);

  const selectedBranch = activeBranches.find((b) => b.id === selectedBranchId);
  const branchAddress = selectedBranch ? branchAddressToShipping(selectedBranch) : null;

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      mode: activeBranches.length > 0 ? 'branch' : 'custom',
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

  // Keep the hidden `mode` form field in sync with the React state so
  // superRefine's discriminator picks the right branch.
  useEffect(() => {
    setValue('mode', mode, { shouldValidate: false });
  }, [mode, setValue]);

  return (
    <form
      onSubmit={handleSubmit((v) => {
        if (mode === 'branch' && branchAddress) {
          // Branch mode: address comes from the selected branch
          // snapshot; buyer-typed recipientName / phone overlay it.
          const cleaned: ShippingAddress = {
            recipientName: v.recipientName.trim(),
            phone: v.phone.trim(),
            line1: (branchAddress.line1 ?? '').trim(),
            line2: branchAddress.line2,
            district: branchAddress.district,
            city: (branchAddress.city ?? '').trim(),
            postalCode: branchAddress.postalCode,
            country: (branchAddress.country ?? 'Türkiye').trim(),
          };
          onSubmit({ address: cleaned, branchId: selectedBranchId || undefined });
          return;
        }
        // Custom mode: strip empty optional strings so the JSON column
        // doesn't carry "" entries. superRefine has already enforced
        // line1/city/country presence in custom mode, but the schema's
        // base TS types still allow undefined — fall back defensively.
        const cleaned: ShippingAddress = {
          recipientName: v.recipientName.trim(),
          phone: v.phone.trim(),
          line1: (v.line1 ?? '').trim(),
          line2: v.line2?.trim() || undefined,
          district: v.district?.trim() || undefined,
          city: (v.city ?? '').trim(),
          postalCode: v.postalCode?.trim() || undefined,
          country: (v.country ?? 'Türkiye').trim(),
        };
        onSubmit({ address: cleaned });
      })}
      className="space-y-3"
    >
      {/* Mode toggle — hidden when no branches exist to keep the
          pre-v2.8.99.3 visual identical. */}
      {activeBranches.length > 0 && (
        <div
          role="radiogroup"
          aria-label="Teslimat adresi modu"
          className="flex gap-2 rounded border bg-gray-50 p-2 text-sm"
        >
          <label className="flex flex-1 cursor-pointer items-center gap-2 rounded px-3 py-2 hover:bg-white">
            <input
              type="radio"
              name="address-mode"
              value="branch"
              checked={mode === 'branch'}
              onChange={() => setMode('branch')}
            />
            <span className="font-medium">Şube adresi</span>
          </label>
          <label className="flex flex-1 cursor-pointer items-center gap-2 rounded px-3 py-2 hover:bg-white">
            <input
              type="radio"
              name="address-mode"
              value="custom"
              checked={mode === 'custom'}
              onChange={() => setMode('custom')}
            />
            <span className="font-medium">Yeni adres</span>
          </label>
        </div>
      )}

      {/* recipientName + phone are ALWAYS editable, in both modes —
          Branch.address doesn't carry them. */}
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

      {mode === 'branch' && activeBranches.length > 0 ? (
        <div className="space-y-2">
          {activeBranches.length > 1 && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-gray-700">Şube seçin</span>
              <select
                aria-label="Şube seçin"
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="w-full rounded border px-3 py-2 text-sm"
              >
                {activeBranches.map((b) => {
                  const a = branchAddressToShipping(b);
                  return (
                    <option key={b.id} value={b.id}>
                      {b.name} — {a.line1 || '—'}
                    </option>
                  );
                })}
              </select>
            </label>
          )}
          <div
            data-testid="branch-address-preview"
            className="rounded border border-dashed bg-gray-50 p-3 text-sm text-gray-700"
          >
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              {selectedBranch?.name ?? 'Şube'}
            </div>
            {branchAddress?.line1 ? (
              <>
                <div>{branchAddress.line1}</div>
                {branchAddress.line2 && <div>{branchAddress.line2}</div>}
                <div>
                  {[branchAddress.district, branchAddress.city, branchAddress.postalCode]
                    .filter(Boolean)
                    .join(' / ')}
                </div>
                <div>{branchAddress.country}</div>
              </>
            ) : (
              <div className="text-gray-500">
                Bu şubenin adresi henüz tanımlanmamış. Yönetici sayfasından doldurun veya
                &quot;Yeni adres&quot; seçin.
              </div>
            )}
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}

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

import React from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import PhoneInput from '../../../components/ui/PhoneInput';
import {
  CalendarDays,
  Clock,
  MapPin,
  User,
  Users,
  Mail,
  Phone,
  StickyNote,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import type { ReservationFormValues } from './types';
import type { AvailableSlot, AvailableTable } from '../../../types';
import { formatReservationDate, formatTime, formatTimeRange } from './utils';
import { ReviewRow } from './parts';

interface StepCommonProps {
  onNext?: () => void;
  onBack?: () => void;
}

// ----------------------------------------------------------------------
// Step 1 — Date + Number of Guests
// ----------------------------------------------------------------------

interface Step1Props extends StepCommonProps {
  minDate: string;
  maxDate: string;
  maxGuests: number;
}

export const Step1DateAndGuests: React.FC<Step1Props> = ({ minDate, maxDate, maxGuests }) => {
  const { t } = useTranslation('reservations');
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<ReservationFormValues>();
  const guestCount = watch('guestCount') || 1;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CalendarDays className="h-4 w-4 text-primary" />
          {t('public.selectDate')}
        </label>
        <input
          type="date"
          min={minDate}
          max={maxDate}
          {...register('date')}
          className="w-full h-12 rounded-xl border border-border bg-background px-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {errors.date && (
          <p className="text-xs text-destructive">{t('public.validation.dateRequired')}</p>
        )}
      </section>

      <section className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Users className="h-4 w-4 text-primary" />
          {t('public.selectGuests')}
        </label>
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-2">
          {Array.from({ length: Math.min(maxGuests, 20) }, (_, i) => i + 1).map((n) => {
            const selected = guestCount === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => setValue('guestCount', n, { shouldValidate: true })}
                className={[
                  'h-12 rounded-xl border text-sm font-medium transition',
                  selected
                    ? 'bg-primary text-primary-foreground border-primary ring-2 ring-primary/30'
                    : 'bg-background border-border text-foreground hover:border-primary/50',
                ].join(' ')}
              >
                {n}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {t('public.guestsCount', { count: guestCount })}
        </p>
      </section>
    </div>
  );
};

// ----------------------------------------------------------------------
// Step 2 — Time Slots
// ----------------------------------------------------------------------

interface Step2Props extends StepCommonProps {
  slots: AvailableSlot[] | undefined;
  isLoading: boolean;
  /** Default reservation duration (min) used to compute endTime. */
  defaultDuration: number;
  /** The chosen reservation date (YYYY-MM-DD). Drives the client-side
   *  past-time filter — when the user picked today, we still drop any
   *  slot whose HH:mm is before "now" even if the backend returned it
   *  as available (defense-in-depth against a stale or misconfigured
   *  `minAdvanceBooking` setting). */
  date: string;
}

export const Step2TimeSlots: React.FC<Step2Props> = ({
  slots,
  isLoading,
  defaultDuration,
  date,
}) => {
  const { t } = useTranslation('reservations');
  const { watch, setValue } = useFormContext<ReservationFormValues>();
  const selectedTime = watch('startTime') || '';

  // Filter out all unavailable slots — past + full + closed. The
  // backend marks them `available: false`; the user explicitly wanted
  // them gone from the UI rather than greyed.
  //
  // Plus an extra past-time guard for today's slots: if the tenant's
  // `minAdvanceBooking` is 0 or the backend forgot to flip a slot to
  // unavailable, we still won't show 09:00 at 13:00. The reservation
  // service applies the same check at create time so a determined POST
  // can't sneak past either.
  const visible = (slots ?? []).filter((s) => {
    if (!s.available) return false;
    if (!date) return true;
    const slotDateTime = new Date(date);
    const [h, m] = s.time.split(':').map(Number);
    slotDateTime.setHours(h, m, 0, 0);
    return slotDateTime.getTime() >= Date.now();
  });

  const handleSelect = (time: string) => {
    setValue('startTime', time, { shouldValidate: true });
    setValue('endTime', addMinutes(time, defaultDuration), { shouldValidate: true });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-3">
        <AlertCircle className="h-6 w-6 text-muted-foreground" />
        {t('public.slots.empty')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Clock className="h-4 w-4 text-primary" />
        {t('public.selectTime')}
      </p>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {visible.map((slot) => {
          const selected = selectedTime === slot.time;
          return (
            <button
              key={slot.time}
              type="button"
              onClick={() => handleSelect(slot.time)}
              className={[
                'h-12 rounded-xl border text-sm font-medium transition',
                selected
                  ? 'bg-primary text-primary-foreground border-primary ring-2 ring-primary/30'
                  : 'bg-background border-border text-foreground hover:border-primary/50',
              ].join(' ')}
            >
              {formatTime(slot.time)}
            </button>
          );
        })}
      </div>
    </div>
  );
};

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ----------------------------------------------------------------------
// Step 3 — Table (optional)
// ----------------------------------------------------------------------

interface Step3Props extends StepCommonProps {
  tables: AvailableTable[] | undefined;
  isLoading: boolean;
}

export const Step3Table: React.FC<Step3Props> = ({ tables, isLoading }) => {
  const { t } = useTranslation('reservations');
  const { watch, setValue } = useFormContext<ReservationFormValues>();
  const selectedId = watch('tableId') || '';

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <MapPin className="h-4 w-4 text-primary" />
        {t('public.selectTable')}
      </p>
      <button
        type="button"
        onClick={() => setValue('tableId', '', { shouldValidate: true })}
        className={[
          'w-full rounded-xl border p-4 text-left transition',
          selectedId === ''
            ? 'bg-primary/10 border-primary ring-2 ring-primary/30'
            : 'bg-background border-border hover:border-primary/50',
        ].join(' ')}
      >
        <p className="font-medium text-foreground">{t('public.anyTable')}</p>
        <p className="text-xs text-muted-foreground">{t('public.anyTableHint')}</p>
      </button>
      <div className="grid grid-cols-2 gap-2">
        {(tables ?? []).map((table) => {
          const selected = selectedId === table.id;
          return (
            <button
              key={table.id}
              type="button"
              onClick={() => setValue('tableId', table.id, { shouldValidate: true })}
              className={[
                'rounded-xl border p-3 text-left transition',
                selected
                  ? 'bg-primary/10 border-primary ring-2 ring-primary/30'
                  : 'bg-background border-border hover:border-primary/50',
              ].join(' ')}
            >
              <p className="font-medium text-foreground">{t('public.table')} {table.number}</p>
              <p className="text-xs text-muted-foreground">
                {table.capacity} {t('public.guestsLabel')}
                {table.section ? ` · ${table.section}` : ''}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// Step 4 — Customer info (name, phone/email, notes)
// ----------------------------------------------------------------------

export const Step4Contact: React.FC<StepCommonProps> = () => {
  const { t } = useTranslation('reservations');
  const {
    register,
    control,
    formState: { errors },
  } = useFormContext<ReservationFormValues>();

  // The cross-field email-or-phone refinement surfaces as
  // errors.customerPhone with message 'contactRequired'. Other
  // messages on the same field are real format errors.
  const phoneError = errors.customerPhone?.message as string | undefined;
  const isContactMissing = phoneError === 'contactRequired';
  const emailError = errors.customerEmail?.message as string | undefined;

  return (
    <div className="space-y-5">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <User className="h-4 w-4 text-primary" />
        {t('public.yourInfo')}
      </p>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">{t('public.name')} *</label>
        <input
          type="text"
          autoComplete="name"
          {...register('customerName')}
          className="w-full h-12 rounded-xl border border-border bg-background px-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {errors.customerName && (
          <p className="text-xs text-destructive">{t('public.validation.nameRequired')}</p>
        )}
      </div>

      <div className="rounded-xl border border-border p-4 space-y-3">
        <p className="text-xs font-semibold text-foreground">{t('public.contactHint')}</p>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5" /> {t('public.phone')}
          </label>
          <Controller
            control={control}
            name="customerPhone"
            render={({ field }) => (
              <PhoneInput
                value={field.value ?? ''}
                onChange={field.onChange}
                defaultCountry="TR"
                // Format errors can't occur now (PhoneInput only emits valid
                // E.164 or ''); keep the existing branch so a real format
                // error would still surface, but suppress the contact-group
                // refinement which renders its own banner below.
                error={
                  phoneError && phoneError !== 'contactRequired'
                    ? t('public.validation.phoneInvalid')
                    : undefined
                }
              />
            )}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" /> {t('public.email')}
          </label>
          <input
            type="email"
            autoComplete="email"
            {...register('customerEmail')}
            className="w-full h-12 rounded-xl border border-border bg-background px-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {emailError && (
            <p className="text-xs text-destructive">{t('public.validation.emailInvalid')}</p>
          )}
        </div>

        {isContactMissing && (
          <p className="text-xs text-destructive flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" />
            {t('public.validation.contactRequired')}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <StickyNote className="h-3.5 w-3.5" /> {t('public.notes')}
        </label>
        <textarea
          rows={3}
          {...register('notes')}
          className="w-full rounded-xl border border-border bg-background px-4 py-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
        />
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------
// Step 5 — Review
// ----------------------------------------------------------------------

interface Step5Props {
  tableName?: string | null;
  /** Called per row's edit pen. Container jumps the wizard back to
   *  the corresponding step and sets `returnToReview` so the user
   *  comes straight back here after committing the change. */
  onEditStep: (step: 1 | 2 | 3 | 4) => void;
}

export const Step5Review: React.FC<Step5Props> = ({ tableName, onEditStep }) => {
  const { t } = useTranslation('reservations');
  const { watch } = useFormContext<ReservationFormValues>();
  const values = watch();

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <User className="h-4 w-4 text-primary" />
        {t('public.review.title')}
      </p>
      <div className="rounded-2xl border border-border bg-card divide-y-0 px-4">
        <ReviewRow
          icon={<CalendarDays className="h-4 w-4" />}
          label={t('public.selectDate')}
          value={formatReservationDate(values.date)}
          onEdit={() => onEditStep(1)}
          editLabel={t('public.review.edit')}
        />
        <ReviewRow
          icon={<Clock className="h-4 w-4" />}
          label={t('public.selectTime')}
          value={formatTimeRange(values.startTime, values.endTime)}
          onEdit={() => onEditStep(2)}
          editLabel={t('public.review.edit')}
        />
        <ReviewRow
          icon={<Users className="h-4 w-4" />}
          label={t('public.selectGuests')}
          value={t('public.guestsCount', { count: values.guestCount })}
          onEdit={() => onEditStep(1)}
          editLabel={t('public.review.edit')}
        />
        <ReviewRow
          icon={<MapPin className="h-4 w-4" />}
          label={t('public.table')}
          value={tableName || t('public.anyTable')}
          onEdit={() => onEditStep(3)}
          editLabel={t('public.review.edit')}
        />
        <ReviewRow
          icon={<User className="h-4 w-4" />}
          label={t('public.customer')}
          value={
            <span>
              {values.customerName}
              <br />
              <span className="text-xs text-muted-foreground">
                {values.customerPhone || values.customerEmail}
              </span>
            </span>
          }
          onEdit={() => onEditStep(4)}
          editLabel={t('public.review.edit')}
        />
        {values.notes && (
          <ReviewRow
            icon={<StickyNote className="h-4 w-4" />}
            label={t('public.notes')}
            value={values.notes}
            onEdit={() => onEditStep(4)}
            editLabel={t('public.review.edit')}
          />
        )}
      </div>
    </div>
  );
};

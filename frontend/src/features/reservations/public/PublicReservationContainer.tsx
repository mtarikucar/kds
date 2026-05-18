import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { Loader2, ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';
import {
  usePublicReservationSettings,
  useAvailableSlots,
  useAvailableTables,
  useCreatePublicReservation,
} from '../publicReservationsApi';
import type { CreateReservationDto, Reservation } from '../../../types';
import { reservationFormSchema } from './schema';
import type { ReservationFormValues, WizardStep } from './types';
import { formatReservationDate, formatTimeRange } from './utils';
import { BannerHeader, WizardStepper, SuccessCard } from './parts';
import {
  Step1DateAndGuests,
  Step2TimeSlots,
  Step3Table,
  Step4Contact,
  Step5Review,
} from './steps';

/**
 * Public reservation wizard — the rebuilt version of the old 836-line
 * monolithic PublicReservationPage. State lives in a single
 * `useForm<ReservationFormValues>` shared via FormProvider with the
 * step subcomponents. Step gating is done with `form.trigger([fields])`
 * before `setStep`. Inline edit from the review step is implemented as
 * a "jump back, return on Next" flow so we reuse every step UI
 * verbatim — no modal duplicates.
 */
const PublicReservationContainer: React.FC = () => {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { t } = useTranslation('reservations');

  const [step, setStep] = useState<WizardStep>(1);
  const [furthestReached, setFurthestReached] = useState<WizardStep>(1);
  const returnToReviewRef = useRef(false);
  const [createdReservation, setCreatedReservation] = useState<Reservation | null>(null);

  const form = useForm<ReservationFormValues>({
    resolver: zodResolver(reservationFormSchema),
    mode: 'onChange',
    defaultValues: {
      date: '',
      guestCount: 2,
      startTime: '',
      endTime: '',
      tableId: '',
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      notes: '',
    },
  });

  const date = form.watch('date');
  const guestCount = form.watch('guestCount');
  const startTime = form.watch('startTime');
  const endTime = form.watch('endTime');
  const tableId = form.watch('tableId');

  const { data: settings, isLoading: settingsLoading, error: settingsError } =
    usePublicReservationSettings(tenantId || '');
  const { data: slots, isLoading: slotsLoading } = useAvailableSlots(
    tenantId || '',
    date,
    guestCount,
  );
  const { data: tables, isLoading: tablesLoading } = useAvailableTables(
    tenantId || '',
    date,
    startTime,
    endTime,
    guestCount,
  );
  const createReservation = useCreatePublicReservation();

  // Today (YYYY-MM-DD) for the <input min> + tenant max-advance for
  // the <input max>. Memoized so the date input doesn't shake on
  // every re-render.
  const minDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  const maxDate = useMemo(() => {
    if (!settings?.maxAdvanceDays) return '';
    const max = new Date();
    max.setDate(max.getDate() + settings.maxAdvanceDays);
    return max.toISOString().split('T')[0];
  }, [settings?.maxAdvanceDays]);

  const selectedTable = useMemo(
    () => (tables ?? []).find((tt) => tt.id === tableId) || null,
    [tables, tableId],
  );

  // Reset downstream choices when an earlier choice changes — picking
  // a new date should invalidate the chosen time, etc.
  useEffect(() => {
    form.setValue('startTime', '');
    form.setValue('endTime', '');
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (startTime && tableId) form.setValue('tableId', '');
  }, [startTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fields each step gates on. Step 3 (table) is optional so it has
  // no required fields — `trigger([])` passes vacuously.
  const stepFields: Record<WizardStep, Array<keyof ReservationFormValues>> = {
    1: ['date', 'guestCount'],
    2: ['startTime', 'endTime'],
    3: [],
    4: ['customerName', 'customerPhone', 'customerEmail'],
    5: [],
  };

  const goTo = (next: WizardStep) => {
    setStep(next);
    if (next > furthestReached) setFurthestReached(next);
  };

  const handleNext = async () => {
    const fields = stepFields[step];
    const valid = fields.length === 0 ? true : await form.trigger(fields);
    if (!valid) return;
    if (returnToReviewRef.current) {
      returnToReviewRef.current = false;
      goTo(5);
      return;
    }
    goTo(Math.min(5, step + 1) as WizardStep);
  };

  const handleBack = () => {
    if (returnToReviewRef.current) {
      // Aborted an edit — drop the flag and return to the review.
      returnToReviewRef.current = false;
      goTo(5);
      return;
    }
    goTo(Math.max(1, step - 1) as WizardStep);
  };

  const handleEditFromReview = async (targetStep: 1 | 2 | 3 | 4) => {
    returnToReviewRef.current = true;
    goTo(targetStep);
  };

  const handleSubmit = form.handleSubmit(async (values) => {
    if (!tenantId) return;
    const payload: CreateReservationDto = {
      date: values.date,
      startTime: values.startTime,
      endTime: values.endTime,
      guestCount: values.guestCount,
      customerName: values.customerName,
      ...(values.customerPhone ? { customerPhone: values.customerPhone } : {}),
      ...(values.customerEmail ? { customerEmail: values.customerEmail } : {}),
      ...(values.notes ? { notes: values.notes } : {}),
      ...(values.tableId ? { tableId: values.tableId } : {}),
    };
    try {
      const reservation = await createReservation.mutateAsync({ tenantId, data: payload });
      setCreatedReservation(reservation);
    } catch {
      // Error toast handled by the mutation hook.
    }
  });

  if (settingsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (settingsError || !settings?.isEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="rounded-2xl border border-border bg-card p-8 max-w-md text-center space-y-3">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
          <h1 className="text-lg font-semibold text-foreground">{t('public.unavailable.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('public.unavailable.description')}</p>
        </div>
      </div>
    );
  }

  // Post-submit success view. The form values are still in scope so we
  // can render a rich summary; the createdReservation drives the
  // confirmation number and an "email-only" hint banner.
  if (createdReservation) {
    const isEmailOnly = !form.getValues('customerPhone');
    return (
      <div className="min-h-screen bg-background py-6 px-4">
        <div className="mx-auto max-w-2xl">
          <SuccessCard
            reservationNumber={createdReservation.reservationNumber}
            formattedDate={formatReservationDate(form.getValues('date'))}
            formattedTime={formatTimeRange(
              form.getValues('startTime'),
              form.getValues('endTime'),
            )}
            guestCount={form.getValues('guestCount')}
            tableName={
              selectedTable ? `${t('public.table')} ${selectedTable.number}` : null
            }
            isEmailOnly={isEmailOnly}
            lookupHref={`/reserve/${tenantId}/lookup`}
          />
        </div>
      </div>
    );
  }

  return (
    <FormProvider {...form}>
      <div className="min-h-screen bg-background py-6 px-4">
        <div className="mx-auto max-w-2xl space-y-6">
          <BannerHeader
            imageUrl={settings.bannerImageUrl}
            title={settings.bannerTitle || t('public.title')}
            description={settings.bannerDescription}
            customMessage={settings.customMessage}
          />

          <WizardStepper
            current={step}
            furthestReached={furthestReached}
            onJump={(s) => {
              // Jumping back from review to edit a step counts as an
              // edit — set the flag so Next returns to review.
              if (step === 5 && s < 5) returnToReviewRef.current = true;
              goTo(s);
            }}
          />

          <form onSubmit={handleSubmit} noValidate>
            {step === 1 && (
              <Step1DateAndGuests
                minDate={minDate}
                maxDate={maxDate}
                maxGuests={settings.maxGuestsPerReservation ?? 20}
              />
            )}
            {step === 2 && (
              <Step2TimeSlots
                slots={slots}
                isLoading={slotsLoading}
                defaultDuration={settings.defaultDuration ?? 60}
              />
            )}
            {step === 3 && <Step3Table tables={tables} isLoading={tablesLoading} />}
            {step === 4 && <Step4Contact />}
            {step === 5 && (
              <Step5Review
                tableName={
                  selectedTable ? `${t('public.table')} ${selectedTable.number}` : null
                }
                onEditStep={handleEditFromReview}
              />
            )}

            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleBack}
                disabled={step === 1}
                className="inline-flex items-center gap-1.5 h-12 px-4 rounded-xl border border-border bg-background text-sm font-medium text-foreground disabled:opacity-40 hover:bg-muted/50 transition"
              >
                <ChevronLeft className="h-4 w-4" />
                {t('public.back')}
              </button>
              {step < 5 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="inline-flex items-center gap-1.5 h-12 px-6 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition"
                >
                  {t('public.next')}
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={createReservation.isPending}
                  className="inline-flex items-center gap-1.5 h-12 px-6 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition disabled:opacity-60"
                >
                  {createReservation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  {t('public.submit')}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </FormProvider>
  );
};

export default PublicReservationContainer;

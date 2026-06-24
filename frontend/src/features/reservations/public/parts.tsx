import React from 'react';
import { Pencil, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface BannerHeaderProps {
  imageUrl?: string | null;
  title?: string | null;
  description?: string | null;
  customMessage?: string | null;
}

/**
 * The hero/info block above the wizard. Renders the tenant's optional
 * banner image + title + description + customMessage. All four are
 * optional; the block collapses gracefully when nothing is set.
 */
export const BannerHeader: React.FC<BannerHeaderProps> = ({
  imageUrl,
  title,
  description,
  customMessage,
}) => {
  if (!imageUrl && !title && !description && !customMessage) return null;

  return (
    <header className="space-y-3">
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          className="w-full aspect-[16/6] object-cover rounded-2xl"
        />
      )}
      {(title || description) && (
        <div className="space-y-1 text-center">
          {title && <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{title}</h1>}
          {description && <p className="text-muted-foreground text-sm sm:text-base">{description}</p>}
        </div>
      )}
      {customMessage && (
        <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 text-sm text-foreground text-center">
          {customMessage}
        </div>
      )}
    </header>
  );
};

interface WizardStepperProps {
  current: 1 | 2 | 3 | 4 | 5;
  /** Highest step number the user has previously reached. Click-to-jump
   *  is allowed only up to this value to prevent skipping. */
  furthestReached: 1 | 2 | 3 | 4 | 5;
  onJump: (step: 1 | 2 | 3 | 4 | 5) => void;
}

/**
 * Visual progress indicator. Five dots connected by lines; click-to-
 * jump only goes backward (or to already-visited steps) so the gating
 * in {@link PublicReservationContainer.handleNext} can't be sneaked
 * past via the stepper itself.
 */
export const WizardStepper: React.FC<WizardStepperProps> = ({
  current,
  furthestReached,
  onJump,
}) => {
  const { t } = useTranslation('reservations');
  const steps: Array<1 | 2 | 3 | 4 | 5> = [1, 2, 3, 4, 5];
  return (
    <div className="flex items-center justify-between gap-1 sm:gap-2" role="navigation" aria-label="Wizard steps">
      {steps.map((s, idx) => {
        const isCurrent = s === current;
        const isReached = s <= furthestReached;
        const isClickable = isReached && s !== current;
        return (
          <React.Fragment key={s}>
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onJump(s)}
              className={[
                'flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full text-xs font-semibold transition',
                isCurrent
                  ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
                  : isReached
                    ? 'bg-primary/80 text-primary-foreground hover:bg-primary cursor-pointer'
                    : 'bg-muted text-muted-foreground',
              ].join(' ')}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {isReached && !isCurrent ? <Check className="h-4 w-4" /> : s}
            </button>
            {idx < steps.length - 1 && (
              <div
                className={[
                  'h-0.5 flex-1 transition',
                  s < furthestReached ? 'bg-primary/80' : 'bg-muted',
                ].join(' ')}
              />
            )}
          </React.Fragment>
        );
      })}
      <span className="hidden sm:inline ml-3 text-xs text-muted-foreground whitespace-nowrap">
        {t('public.step')} {current} {t('public.of')} 5
      </span>
    </div>
  );
};

interface ReviewRowProps {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  onEdit?: () => void;
  editLabel?: string;
}

/**
 * Read-only summary row used in the step-5 review. Each row has an
 * optional edit affordance; clicking the pencil jumps the wizard
 * back to the corresponding step (managed by the container) and
 * comes straight back to step 5 after the user confirms there.
 */
export const ReviewRow: React.FC<ReviewRowProps> = ({ label, value, icon, onEdit, editLabel }) => (
  <div className="flex items-start gap-3 py-3 border-b border-border last:border-b-0">
    <div className="text-muted-foreground mt-0.5 shrink-0">{icon}</div>
    <div className="flex-1 min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground break-words">{value}</p>
    </div>
    {onEdit && (
      <button
        type="button"
        onClick={onEdit}
        className="text-primary hover:text-primary/80 p-1 -m-1 rounded-md hover:bg-primary/5 transition"
        aria-label={editLabel}
      >
        <Pencil className="h-4 w-4" />
      </button>
    )}
  </div>
);

interface SuccessCardProps {
  reservationNumber: string;
  /** Date is shown via formatReservationDate from the shared util. */
  formattedDate: string;
  /** "2:30 PM — 4:00 PM" pre-formatted. */
  formattedTime: string;
  guestCount: number;
  tableName?: string | null;
  /** True when the customer left no phone — show the "call us to cancel" copy. */
  isEmailOnly: boolean;
  lookupHref: string;
}

/**
 * Confirmation card shown after a successful POST. Renders the
 * reservation number prominently (the customer needs it for the
 * lookup/cancel flow) and surfaces the "call us to cancel" guidance
 * for email-only customers whose phone-based auth path doesn't exist
 * yet.
 *
 * Honesty (fake-working sweep #3): the email-only hint copy is
 * deliberately non-committal ("if the restaurant has email confirmations
 * enabled, a message WILL be sent") rather than asserting a completed send
 * ("we've sent confirmation"). The backend reservation notify path is
 * fire-and-forget and gated on the per-event `emailOnReservationCreated`
 * toggle + a configured mailer, so at response time the client cannot know
 * an email was actually delivered — claiming it would be a lie when the
 * toggle is off or the mailer is unconfigured.
 */
export const SuccessCard: React.FC<SuccessCardProps> = ({
  reservationNumber,
  formattedDate,
  formattedTime,
  guestCount,
  tableName,
  isEmailOnly,
  lookupHref,
}) => {
  const { t } = useTranslation('reservations');
  return (
    <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 space-y-5 text-center">
      <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
        <Check className="h-8 w-8 text-emerald-500" />
      </div>
      <div className="space-y-1">
        <h2 className="text-xl sm:text-2xl font-bold text-foreground">{t('public.successPending')}</h2>
        <p className="text-sm text-muted-foreground">{t('public.successDescription')}</p>
      </div>
      <div className="rounded-xl bg-muted/40 p-4 space-y-2 text-left">
        <p className="text-xs text-muted-foreground">{t('public.yourReservationNumber')}</p>
        <p className="text-2xl sm:text-3xl font-bold text-primary tracking-wide font-mono break-all">
          {reservationNumber}
        </p>
        <div className="pt-2 space-y-1 text-sm">
          <p className="text-foreground">{formattedDate}</p>
          <p className="text-foreground">{formattedTime}</p>
          <p className="text-foreground">{t('public.guestsCount', { count: guestCount })}</p>
          {tableName && <p className="text-muted-foreground">{tableName}</p>}
        </div>
      </div>
      {isEmailOnly && (
        <div className="text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-3">
          {t('public.successEmailOnlyCancelHint')}
        </div>
      )}
      <Link
        to={lookupHref}
        className="inline-block text-sm font-medium text-primary hover:text-primary/80"
      >
        {t('public.checkYourReservation')}
      </Link>
    </div>
  );
};

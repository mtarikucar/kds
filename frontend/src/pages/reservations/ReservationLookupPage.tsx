import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Search,
  CalendarDays,
  Clock,
  Users,
  MapPin,
  Phone,
  X,
  AlertCircle,
  Loader2,
  ArrowLeft,
  Hash,
} from 'lucide-react';
import {
  useLookupReservation,
  useCancelPublicReservation,
} from '../../features/reservations/publicReservationsApi';
import type { Reservation, ReservationStatus } from '../../types';
import {
  formatReservationDate,
  formatTimeRange,
} from '../../features/reservations/public/utils';
import { ReviewRow } from '../../features/reservations/public/parts';

const STATUS_STYLES: Record<string, { dot: string; bg: string; text: string }> = {
  PENDING: { dot: 'bg-yellow-500', bg: 'bg-yellow-500/15', text: 'text-yellow-700 dark:text-yellow-300' },
  CONFIRMED: { dot: 'bg-emerald-500', bg: 'bg-emerald-500/15', text: 'text-emerald-700 dark:text-emerald-300' },
  REJECTED: { dot: 'bg-red-500', bg: 'bg-red-500/15', text: 'text-red-700 dark:text-red-300' },
  SEATED: { dot: 'bg-primary', bg: 'bg-primary/15', text: 'text-primary' },
  COMPLETED: { dot: 'bg-slate-500', bg: 'bg-slate-500/15', text: 'text-slate-700 dark:text-slate-300' },
  CANCELLED: { dot: 'bg-red-400', bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400' },
  NO_SHOW: { dot: 'bg-amber-500', bg: 'bg-amber-500/15', text: 'text-amber-700 dark:text-amber-300' },
};

const ReservationLookupPage: React.FC = () => {
  const { tenantId } = useParams<{ tenantId: string }>();
  const { t } = useTranslation('reservations');

  const [phone, setPhone] = useState('');
  const [reservationNumber, setReservationNumber] = useState('');
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const lookupMutation = useLookupReservation();
  const cancelMutation = useCancelPublicReservation();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantId || !phone.trim() || !reservationNumber.trim()) return;
    setNotFound(false);
    setReservation(null);
    try {
      const result = await lookupMutation.mutateAsync({
        tenantId,
        phone: phone.trim(),
        reservationNumber: reservationNumber.trim(),
      });
      setReservation(result);
    } catch {
      setNotFound(true);
    }
  };

  const handleCancel = async () => {
    if (!tenantId || !reservation) return;
    try {
      const updated = await cancelMutation.mutateAsync({
        tenantId,
        id: reservation.id,
        customerPhone: phone.trim(),
        reservationNumber: reservationNumber.trim(),
      });
      setReservation({ ...reservation, ...updated });
      setShowCancelConfirm(false);
    } catch {
      // mutation state surfaces the error
    }
  };

  const canCancel = (status: ReservationStatus | string): boolean =>
    status === 'PENDING' || status === 'CONFIRMED';

  const statusStyle = (status: string) => STATUS_STYLES[status] || STATUS_STYLES.PENDING;

  return (
    <div className="min-h-screen bg-background py-6 px-4">
      <div className="mx-auto max-w-2xl space-y-6">
        <Link
          to={`/reserve/${tenantId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('public.title')}
        </Link>

        <div className="space-y-1">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">{t('lookup.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('lookup.description')}</p>
        </div>

        <form
          onSubmit={handleSearch}
          className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-4"
        >
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Phone className="h-3.5 w-3.5" /> {t('lookup.phone')}
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full h-12 rounded-xl border border-border bg-background px-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Hash className="h-3.5 w-3.5" /> {t('lookup.reservationNumber')}
            </label>
            <input
              type="text"
              value={reservationNumber}
              onChange={(e) => setReservationNumber(e.target.value)}
              className="w-full h-12 rounded-xl border border-border bg-background px-4 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              required
            />
          </div>
          <button
            type="submit"
            disabled={lookupMutation.isPending}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            {lookupMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {t('lookup.search')}
          </button>
        </form>

        {notFound && (
          <div className="rounded-xl border border-border bg-card p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-foreground">{t('lookup.notFound')}</p>
          </div>
        )}

        {reservation && (
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="p-5 sm:p-6 space-y-1 border-b border-border">
              <p className="text-xs text-muted-foreground">{t('public.yourReservationNumber')}</p>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xl sm:text-2xl font-bold text-foreground font-mono break-all">
                  {reservation.reservationNumber}
                </p>
                <span
                  className={[
                    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
                    statusStyle(reservation.status).bg,
                    statusStyle(reservation.status).text,
                  ].join(' ')}
                >
                  <span className={['h-1.5 w-1.5 rounded-full', statusStyle(reservation.status).dot].join(' ')} />
                  {t(`status.${reservation.status}`)}
                </span>
              </div>
            </div>
            <div className="px-5 sm:px-6">
              <ReviewRow
                icon={<CalendarDays className="h-4 w-4" />}
                label={t('public.selectDate')}
                value={formatReservationDate(reservation.date)}
              />
              <ReviewRow
                icon={<Clock className="h-4 w-4" />}
                label={t('public.selectTime')}
                value={formatTimeRange(reservation.startTime, reservation.endTime)}
              />
              <ReviewRow
                icon={<Users className="h-4 w-4" />}
                label={t('public.selectGuests')}
                value={t('public.guestsCount', { count: reservation.guestCount })}
              />
              {reservation.table && (
                <ReviewRow
                  icon={<MapPin className="h-4 w-4" />}
                  label={t('public.table')}
                  value={`${t('public.table')} ${reservation.table.number}${reservation.table.section ? ` — ${reservation.table.section}` : ''}`}
                />
              )}
            </div>
            {canCancel(reservation.status) && (
              <div className="p-5 sm:p-6 pt-0">
                <button
                  type="button"
                  onClick={() => setShowCancelConfirm(true)}
                  className="w-full h-12 rounded-xl border border-destructive/40 bg-destructive/5 text-destructive text-sm font-semibold hover:bg-destructive/10 transition inline-flex items-center justify-center gap-2"
                >
                  <X className="h-4 w-4" />
                  {t('lookup.cancel')}
                </button>
              </div>
            )}
          </div>
        )}

        {showCancelConfirm && reservation && (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4"
            onClick={() => !cancelMutation.isPending && setShowCancelConfirm(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl bg-card p-6 space-y-4"
            >
              <h2 className="text-lg font-semibold text-foreground">{t('lookup.cancelTitle')}</h2>
              <p className="text-sm text-muted-foreground">{t('lookup.cancelConfirm')}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowCancelConfirm(false)}
                  disabled={cancelMutation.isPending}
                  className="flex-1 h-11 rounded-xl border border-border bg-background text-sm font-medium hover:bg-muted/50 transition disabled:opacity-50"
                >
                  {t('lookup.keep')}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={cancelMutation.isPending}
                  className="flex-1 h-11 rounded-xl bg-destructive text-destructive-foreground text-sm font-semibold hover:bg-destructive/90 transition inline-flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  {cancelMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t('lookup.confirmCancel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReservationLookupPage;

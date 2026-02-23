import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Search,
  Calendar,
  Clock,
  Users,
  MapPin,
  X,
  AlertCircle,
  Loader2,
  ArrowLeft,
} from 'lucide-react';
import {
  useLookupReservation,
  useCancelPublicReservation,
} from '../../features/reservations/publicReservationsApi';
import type { Reservation, ReservationStatus } from '../../types';

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  PENDING: { bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  CONFIRMED: { bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  REJECTED: { bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
  SEATED: { bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
  COMPLETED: { bg: 'bg-gray-50', text: 'text-gray-700', dot: 'bg-gray-500' },
  CANCELLED: { bg: 'bg-red-50', text: 'text-red-600', dot: 'bg-red-400' },
  NO_SHOW: { bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
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
      });
      setReservation(updated);
      setShowCancelConfirm(false);
    } catch {
      // Error handled by mutation state
    }
  };

  const canCancel = (status: ReservationStatus | string): boolean => {
    return status === 'PENDING' || status === 'CONFIRMED';
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTime = (time: string): string => {
    const [hours, minutes] = time.split(':');
    const h = parseInt(hours, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 || 12;
    return `${displayH}:${minutes} ${ampm}`;
  };

  const getStatusStyle = (status: string) => {
    return STATUS_COLORS[status] || STATUS_COLORS.PENDING;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Back link */}
        <Link
          to={`/reserve/${tenantId}`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('public.title')}
        </Link>

        {/* Title */}
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('lookup.title')}</h1>
        <p className="text-gray-500 mb-8">{t('lookup.description')}</p>

        {/* Search form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <form onSubmit={handleSearch} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('lookup.phone')}
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                placeholder={t('lookup.phone')}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('lookup.reservationNumber')}
              </label>
              <input
                type="text"
                value={reservationNumber}
                onChange={(e) => setReservationNumber(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                placeholder={t('lookup.reservationNumber')}
                required
              />
            </div>

            <button
              type="submit"
              disabled={lookupMutation.isPending || !phone.trim() || !reservationNumber.trim()}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {lookupMutation.isPending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Search className="w-5 h-5" />
              )}
              {t('lookup.search')}
            </button>
          </form>
        </div>

        {/* Not found */}
        {notFound && (
          <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-6 text-center">
            <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <AlertCircle className="w-7 h-7 text-red-400" />
            </div>
            <p className="text-gray-700 font-medium">{t('lookup.notFound')}</p>
          </div>
        )}

        {/* Reservation details */}
        {reservation && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            {/* Header: number + status */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <p className="text-sm text-gray-500">{t('detail.reservationNumber')}</p>
                <p className="text-2xl font-bold text-gray-900">
                  {reservation.reservationNumber}
                </p>
              </div>
              <div
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${getStatusStyle(reservation.status).bg} ${getStatusStyle(reservation.status).text}`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${getStatusStyle(reservation.status).dot}`}
                />
                {t(`status.${reservation.status}`)}
              </div>
            </div>

            {/* Details */}
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Calendar className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div>
                  <p className="text-sm text-gray-500">{t('detail.date')}</p>
                  <p className="font-medium text-gray-900">{formatDate(reservation.date)}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div>
                  <p className="text-sm text-gray-500">{t('detail.time')}</p>
                  <p className="font-medium text-gray-900">
                    {formatTime(reservation.startTime)} - {formatTime(reservation.endTime)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div>
                  <p className="text-sm text-gray-500">{t('detail.guests')}</p>
                  <p className="font-medium text-gray-900">
                    {reservation.guestCount}{' '}
                    {reservation.guestCount === 1 ? t('public.guest') : t('public.guests')}
                  </p>
                </div>
              </div>

              {reservation.table && (
                <div className="flex items-center gap-3">
                  <MapPin className="w-5 h-5 text-gray-400 flex-shrink-0" />
                  <div>
                    <p className="text-sm text-gray-500">{t('detail.table')}</p>
                    <p className="font-medium text-gray-900">
                      {t('detail.table')} {reservation.table.number}
                      {reservation.table.section && ` - ${reservation.table.section}`}
                    </p>
                  </div>
                </div>
              )}

              {reservation.notes && (
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-sm text-gray-500">{t('detail.notes')}</p>
                  <p className="text-sm text-gray-700 mt-1">{reservation.notes}</p>
                </div>
              )}

              {reservation.rejectionReason && (
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-sm text-gray-500">{t('detail.rejectionReason')}</p>
                  <p className="text-sm text-red-600 mt-1">{reservation.rejectionReason}</p>
                </div>
              )}
            </div>

            {/* Cancel button */}
            {canCancel(reservation.status) && (
              <div className="mt-6 pt-4 border-t border-gray-100">
                {!showCancelConfirm ? (
                  <button
                    onClick={() => setShowCancelConfirm(true)}
                    className="w-full py-3 border-2 border-red-200 text-red-600 rounded-xl font-medium hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    {t('actions.cancel')}
                  </button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-gray-700 text-center">
                      {t('lookup.cancelConfirm')}
                    </p>

                    {cancelMutation.isError && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        <p className="text-sm text-red-700">
                          {(cancelMutation.error as any)?.response?.data?.message ||
                            t('lookup.deadlinePassed')}
                        </p>
                      </div>
                    )}

                    <div className="flex gap-3">
                      <button
                        onClick={() => setShowCancelConfirm(false)}
                        className="flex-1 py-2.5 border border-gray-300 text-gray-700 rounded-xl font-medium hover:bg-gray-50 transition-colors"
                      >
                        {t('public.back')}
                      </button>
                      <button
                        onClick={handleCancel}
                        disabled={cancelMutation.isPending}
                        className="flex-1 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {cancelMutation.isPending ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <X className="w-4 h-4" />
                        )}
                        {t('actions.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReservationLookupPage;

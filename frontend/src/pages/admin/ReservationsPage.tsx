import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  Clock,
  Users,
  CheckCircle,
  XCircle,
  Search,
  Eye,
  UserCheck,
  UserX,
  Ban,
  LogIn,
  CheckSquare,
  AlertTriangle,
} from 'lucide-react';
import {
  useReservations,
  useReservationStats,
  useConfirmReservation,
  useRejectReservation,
  useSeatReservation,
  useCompleteReservation,
  useNoShowReservation,
  useCancelReservation,
  useUpdateReservation,
} from '../../features/reservations/reservationsApi';
import { useTables } from '../../features/tables/tablesApi';
import type { Reservation } from '../../types';
import { ReservationStatus } from '../../types';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';

type StatusFilter = 'ALL' | ReservationStatus;

const ReservationsPage = () => {
  const { t } = useTranslation(['reservations', 'common']);

  const today = new Date().toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(today);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [editAdminNotes, setEditAdminNotes] = useState('');
  const [editTableId, setEditTableId] = useState('');

  // Queries
  const { data: reservations, isLoading } = useReservations({
    date: selectedDate,
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    search: searchQuery || undefined,
  });
  const { data: stats } = useReservationStats(selectedDate);
  const { data: tables } = useTables();

  // Mutations
  const { mutate: confirmReservation, isPending: isConfirming } = useConfirmReservation();
  const { mutate: rejectReservation, isPending: isRejecting } = useRejectReservation();
  const { mutate: seatReservation, isPending: isSeating } = useSeatReservation();
  const { mutate: completeReservation, isPending: isCompleting } = useCompleteReservation();
  const { mutate: noShowReservation, isPending: isMarkingNoShow } = useNoShowReservation();
  const { mutate: cancelReservation, isPending: isCancelling } = useCancelReservation();
  const { mutate: updateReservation, isPending: isUpdating } = useUpdateReservation();

  const isActionPending = isConfirming || isRejecting || isSeating || isCompleting || isMarkingNoShow || isCancelling;

  // Status filter tabs
  const statusTabs: { value: StatusFilter; label: string }[] = useMemo(
    () => [
      { value: 'ALL', label: t('reservations:filters.all') },
      { value: ReservationStatus.PENDING, label: t('reservations:filters.pending') },
      { value: ReservationStatus.CONFIRMED, label: t('reservations:filters.confirmed') },
      { value: ReservationStatus.SEATED, label: t('reservations:filters.seated') },
      { value: ReservationStatus.COMPLETED, label: t('reservations:filters.completed') },
      { value: ReservationStatus.CANCELLED, label: t('reservations:filters.cancelled') },
    ],
    [t]
  );

  // Status badge configuration
  const getStatusBadge = (status: ReservationStatus) => {
    switch (status) {
      case ReservationStatus.PENDING:
        return { variant: 'warning' as const, label: t('reservations:status.pending') };
      case ReservationStatus.CONFIRMED:
        return { variant: 'info' as const, label: t('reservations:status.confirmed') };
      case ReservationStatus.REJECTED:
        return { variant: 'danger' as const, label: t('reservations:status.rejected') };
      case ReservationStatus.SEATED:
        return { variant: 'success' as const, label: t('reservations:status.seated') };
      case ReservationStatus.COMPLETED:
        return { variant: 'default' as const, label: t('reservations:status.completed') };
      case ReservationStatus.CANCELLED:
        return { variant: 'danger' as const, label: t('reservations:status.cancelled') };
      case ReservationStatus.NO_SHOW:
        return { variant: 'warning' as const, label: t('reservations:status.noShow') };
      default:
        return { variant: 'default' as const, label: String(status) };
    }
  };

  // Format time for display
  const formatTime = (time: string) => {
    if (!time) return '';
    // Handle HH:mm or HH:mm:ss format
    const parts = time.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parts[1];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes} ${ampm}`;
  };

  // Open detail modal
  const handleViewDetail = (reservation: Reservation) => {
    setSelectedReservation(reservation);
    setEditAdminNotes(reservation.adminNotes || '');
    setEditTableId(reservation.tableId || '');
    setDetailModalOpen(true);
  };

  // Save admin notes and table assignment
  const handleSaveDetails = () => {
    if (!selectedReservation) return;
    updateReservation(
      {
        id: selectedReservation.id,
        data: {
          adminNotes: editAdminNotes,
          tableId: editTableId || undefined,
        },
      },
      {
        onSuccess: () => {
          setDetailModalOpen(false);
        },
      }
    );
  };

  // Stat cards data
  const statCards = [
    {
      label: t('reservations:stats.total'),
      value: stats?.total ?? 0,
      icon: CalendarDays,
      gradient: 'bg-gradient-to-br from-primary-500 to-primary-600',
      lightBg: 'bg-primary-50',
      textColor: 'text-primary-700',
    },
    {
      label: t('reservations:stats.pending'),
      value: stats?.pending ?? 0,
      icon: Clock,
      gradient: 'bg-gradient-to-br from-amber-500 to-amber-600',
      lightBg: 'bg-amber-50',
      textColor: 'text-amber-700',
    },
    {
      label: t('reservations:stats.confirmed'),
      value: stats?.confirmed ?? 0,
      icon: CheckCircle,
      gradient: 'bg-gradient-to-br from-blue-500 to-blue-600',
      lightBg: 'bg-blue-50',
      textColor: 'text-blue-700',
    },
    {
      label: t('reservations:stats.seated'),
      value: stats?.seated ?? 0,
      icon: Users,
      gradient: 'bg-gradient-to-br from-emerald-500 to-emerald-600',
      lightBg: 'bg-emerald-50',
      textColor: 'text-emerald-700',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-shrink-0 items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
            <CalendarDays className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="font-heading font-bold text-slate-900 text-2xl">
              {t('reservations:page.title')}
            </h1>
            <p className="text-slate-500 mt-0.5">{t('reservations:page.description')}</p>
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <div
              key={stat.label}
              className="bg-white rounded-2xl border border-slate-200/60 p-5 hover:shadow-md transition-all duration-300"
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl ${stat.gradient} flex items-center justify-center shadow-lg`}>
                  <Icon className="w-5 h-5 text-white" />
                </div>
                <span className={`text-2xl font-bold ${stat.textColor}`}>
                  {stat.value}
                </span>
              </div>
              <p className="text-sm text-slate-500 font-medium">{stat.label}</p>
            </div>
          );
        })}
      </div>

      {/* Filters Row */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        {/* Date Picker */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700">
            {t('reservations:filters.date')}:
          </label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3.5 py-2 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 hover:border-slate-300 transition-all duration-200"
          />
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder={t('reservations:filters.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3.5 py-2 border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 hover:border-slate-300 transition-all duration-200"
          />
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
        {statusTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-200 ${
              statusFilter === tab.value
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Content */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : !reservations || reservations.length === 0 ? (
        /* Empty State */
        <div className="bg-white rounded-2xl border border-slate-200/60 py-16 text-center">
          <div className="mx-auto w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
            <CalendarDays className="w-10 h-10 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900">
            {t('reservations:page.noReservations')}
          </h3>
          <p className="mt-2 text-sm text-slate-500 max-w-sm mx-auto">
            {t('reservations:page.noReservationsDescription')}
          </p>
        </div>
      ) : (
        /* Reservations Table */
        <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {t('reservations:table.time')}
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {t('reservations:table.customer')}
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {t('reservations:table.guests')}
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {t('reservations:table.table')}
                  </th>
                  <th className="text-left px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {t('reservations:table.status')}
                  </th>
                  <th className="text-right px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    {t('reservations:table.actions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reservations.map((reservation) => {
                  const statusBadge = getStatusBadge(reservation.status);
                  return (
                    <tr
                      key={reservation.id}
                      className="hover:bg-slate-50/50 transition-colors duration-150"
                    >
                      {/* Time */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-slate-400" />
                          <span className="text-sm font-medium text-slate-900">
                            {formatTime(reservation.startTime)}
                          </span>
                          <span className="text-xs text-slate-400">-</span>
                          <span className="text-sm text-slate-500">
                            {formatTime(reservation.endTime)}
                          </span>
                        </div>
                      </td>

                      {/* Customer */}
                      <td className="px-6 py-4">
                        <div>
                          <p className="text-sm font-medium text-slate-900">
                            {reservation.customerName}
                          </p>
                          <p className="text-xs text-slate-500">{reservation.customerPhone}</p>
                        </div>
                      </td>

                      {/* Guests */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5">
                          <Users className="w-4 h-4 text-slate-400" />
                          <span className="text-sm text-slate-700">{reservation.guestCount}</span>
                        </div>
                      </td>

                      {/* Table */}
                      <td className="px-6 py-4">
                        <span className="text-sm text-slate-700">
                          {reservation.table
                            ? `${t('reservations:table.tablePrefix')} ${reservation.table.number}`
                            : t('reservations:table.unassigned')}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="px-6 py-4">
                        <Badge variant={statusBadge.variant} size="sm">
                          {statusBadge.label}
                        </Badge>
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* View Detail */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleViewDetail(reservation)}
                            title={t('reservations:actions.viewDetail')}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>

                          {/* PENDING actions: Confirm, Reject, Cancel */}
                          {reservation.status === ReservationStatus.PENDING && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                                onClick={() => confirmReservation(reservation.id)}
                                disabled={isActionPending}
                                title={t('reservations:actions.confirm')}
                              >
                                <UserCheck className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-500 hover:bg-red-50 hover:text-red-600"
                                onClick={() =>
                                  rejectReservation({ id: reservation.id })
                                }
                                disabled={isActionPending}
                                title={t('reservations:actions.reject')}
                              >
                                <UserX className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-slate-500 hover:bg-slate-100 hover:text-slate-600"
                                onClick={() => cancelReservation(reservation.id)}
                                disabled={isActionPending}
                                title={t('reservations:actions.cancel')}
                              >
                                <Ban className="h-4 w-4" />
                              </Button>
                            </>
                          )}

                          {/* CONFIRMED actions: Seat, Cancel, No-Show */}
                          {reservation.status === ReservationStatus.CONFIRMED && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                                onClick={() => seatReservation(reservation.id)}
                                disabled={isActionPending}
                                title={t('reservations:actions.seat')}
                              >
                                <LogIn className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-slate-500 hover:bg-slate-100 hover:text-slate-600"
                                onClick={() => cancelReservation(reservation.id)}
                                disabled={isActionPending}
                                title={t('reservations:actions.cancel')}
                              >
                                <Ban className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                                onClick={() => noShowReservation(reservation.id)}
                                disabled={isActionPending}
                                title={t('reservations:actions.noShow')}
                              >
                                <AlertTriangle className="h-4 w-4" />
                              </Button>
                            </>
                          )}

                          {/* SEATED actions: Complete */}
                          {reservation.status === ReservationStatus.SEATED && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                              onClick={() => completeReservation(reservation.id)}
                              disabled={isActionPending}
                              title={t('reservations:actions.complete')}
                            >
                              <CheckSquare className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail / Edit Modal */}
      <Modal
        isOpen={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title={t('reservations:detail.title')}
        size="lg"
      >
        {selectedReservation && (
          <div className="space-y-6">
            {/* Reservation Number & Status */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">
                  {t('reservations:detail.reservationNumber')}
                </p>
                <p className="text-lg font-bold text-slate-900 mt-0.5">
                  #{selectedReservation.reservationNumber}
                </p>
              </div>
              <Badge variant={getStatusBadge(selectedReservation.status).variant}>
                {getStatusBadge(selectedReservation.status).label}
              </Badge>
            </div>

            {/* Info Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Customer */}
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
                  {t('reservations:detail.customer')}
                </p>
                <p className="text-sm font-medium text-slate-900">
                  {selectedReservation.customerName}
                </p>
                <p className="text-sm text-slate-600 mt-1">
                  {selectedReservation.customerPhone}
                </p>
                {selectedReservation.customerEmail && (
                  <p className="text-sm text-slate-600 mt-0.5">
                    {selectedReservation.customerEmail}
                  </p>
                )}
              </div>

              {/* Date & Time */}
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
                  {t('reservations:detail.dateTime')}
                </p>
                <p className="text-sm font-medium text-slate-900">
                  {new Date(selectedReservation.date).toLocaleDateString(undefined, {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </p>
                <p className="text-sm text-slate-600 mt-1">
                  {formatTime(selectedReservation.startTime)} - {formatTime(selectedReservation.endTime)}
                </p>
              </div>

              {/* Guests */}
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
                  {t('reservations:detail.guests')}
                </p>
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-slate-500" />
                  <span className="text-sm font-medium text-slate-900">
                    {selectedReservation.guestCount} {t('reservations:detail.people')}
                  </span>
                </div>
              </div>

              {/* Current Table */}
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
                  {t('reservations:detail.assignedTable')}
                </p>
                <p className="text-sm font-medium text-slate-900">
                  {selectedReservation.table
                    ? `${t('reservations:table.tablePrefix')} ${selectedReservation.table.number} (${selectedReservation.table.capacity} ${t('reservations:detail.seats')})`
                    : t('reservations:table.unassigned')}
                </p>
              </div>
            </div>

            {/* Guest Notes */}
            {selectedReservation.notes && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
                  {t('reservations:detail.guestNotes')}
                </p>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="text-sm text-amber-800">{selectedReservation.notes}</p>
                </div>
              </div>
            )}

            {/* Rejection Reason */}
            {selectedReservation.rejectionReason && (
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
                  {t('reservations:detail.rejectionReason')}
                </p>
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-sm text-red-800">{selectedReservation.rejectionReason}</p>
                </div>
              </div>
            )}

            {/* Editable: Table Assignment */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('reservations:detail.assignTable')}
              </label>
              <select
                value={editTableId}
                onChange={(e) => setEditTableId(e.target.value)}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 hover:border-slate-300 transition-all duration-200"
              >
                <option value="">{t('reservations:detail.noTable')}</option>
                {tables?.map((table) => (
                  <option key={table.id} value={table.id}>
                    {t('reservations:table.tablePrefix')} {table.number} ({table.capacity} {t('reservations:detail.seats')})
                  </option>
                ))}
              </select>
            </div>

            {/* Editable: Admin Notes */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('reservations:detail.adminNotes')}
              </label>
              <textarea
                value={editAdminNotes}
                onChange={(e) => setEditAdminNotes(e.target.value)}
                rows={3}
                placeholder={t('reservations:detail.adminNotesPlaceholder')}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 hover:border-slate-300 transition-all duration-200 resize-none"
              />
            </div>

            {/* Timestamps */}
            <div className="border-t border-slate-100 pt-4">
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                <p>
                  {t('reservations:detail.createdAt')}:{' '}
                  {new Date(selectedReservation.createdAt).toLocaleString()}
                </p>
                {selectedReservation.confirmedAt && (
                  <p>
                    {t('reservations:detail.confirmedAt')}:{' '}
                    {new Date(selectedReservation.confirmedAt).toLocaleString()}
                  </p>
                )}
                {selectedReservation.seatedAt && (
                  <p>
                    {t('reservations:detail.seatedAt')}:{' '}
                    {new Date(selectedReservation.seatedAt).toLocaleString()}
                  </p>
                )}
                {selectedReservation.completedAt && (
                  <p>
                    {t('reservations:detail.completedAt')}:{' '}
                    {new Date(selectedReservation.completedAt).toLocaleString()}
                  </p>
                )}
                {selectedReservation.cancelledAt && (
                  <p>
                    {t('reservations:detail.cancelledAt')}:{' '}
                    {new Date(selectedReservation.cancelledAt).toLocaleString()}
                  </p>
                )}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setDetailModalOpen(false)}
              >
                {t('common:app.cancel')}
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={handleSaveDetails}
                isLoading={isUpdating}
              >
                {t('common:app.save')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default ReservationsPage;

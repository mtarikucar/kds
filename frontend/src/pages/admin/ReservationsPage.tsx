import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  Clock,
  Users,
  CheckCircle,
  Search,
  Eye,
  UserCheck,
  UserX,
  Ban,
  LogIn,
  CheckSquare,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Plus,
  Inbox,
  CalendarRange,
} from 'lucide-react';
import {
  useReservations,
  useReservationStats,
  useReservationSettings,
  usePendingReservationCount,
  useConfirmReservation,
  useRejectReservation,
  useSeatReservation,
  useCompleteReservation,
  useNoShowReservation,
  useCancelReservation,
  useUpdateReservation,
  useCreateReservation,
  type CreateStaffReservationDto,
} from '../../features/reservations/reservationsApi';
import { useReservationsSocket } from '../../features/reservations/useReservationsSocket';
import {
  useAvailableSlots,
  useAvailableTables,
} from '../../features/reservations/publicReservationsApi';
import { useTables } from '../../features/tables/tablesApi';
import { useAuthStore } from '../../store/authStore';
import { useBranchScopeStore } from '../../store/branchScopeStore';
import type { Reservation } from '../../types';
import { ReservationStatus } from '../../types';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import FeatureGate from '../../components/subscriptions/FeatureGate';

type StatusFilter = 'ALL' | ReservationStatus;
type ViewTab = 'day' | 'pending' | 'upcoming';

const PAGE_SIZE = 20;
const UPCOMING_DAYS = 14;

// --- date/time helpers (UTC-anchored to match backend @db.Date storage) ---

/** UTC "today" as YYYY-MM-DD (matches the backend's UTC-midnight anchoring). */
function todayUtc(): string {
  return new Date().toISOString().split('T')[0];
}

/** Add days to a YYYY-MM-DD string using UTC math (no local-tz drift). */
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

/** Normalize a reservation.date (date-only or full ISO) to YYYY-MM-DD. */
function dateKey(date: string): string {
  return date.slice(0, 10);
}

/** 24h HH:mm — replaces the previous 12h AM/PM formatter. */
function formatTime(time?: string): string {
  if (!time) return '';
  const [h, m = '00'] = time.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

/** Add minutes to an HH:mm time, wrapping within a day. */
function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map((v) => parseInt(v, 10));
  const total = ((h * 60 + m + minutes) % (24 * 60) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const ReservationsPage = () => {
  const { t, i18n } = useTranslation(['reservations', 'common']);
  const lng = i18n.language;

  // Reservation date-only values carry no tz; format them anchored to UTC so
  // a 00:00Z date never rolls back a calendar day in negative-offset zones.
  const formatDate = (date: string, opts?: Intl.DateTimeFormatOptions) =>
    new Date(date).toLocaleDateString(lng, { timeZone: 'UTC', ...opts });

  const today = useMemo(() => todayUtc(), []);
  const tenantId = useAuthStore((s) => s.user?.tenantId) || '';
  const branchId = useBranchScopeStore((s) => s.branchId);

  // Keep the admin surface live on reservation:new / reservation:updated.
  useReservationsSocket();

  const [viewTab, setViewTab] = useState<ViewTab>('day');
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedUpcomingDay, setSelectedUpcomingDay] = useState(today);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Detail modal + editable fields
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [edit, setEdit] = useState({
    date: '',
    startTime: '',
    endTime: '',
    guestCount: 2,
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    notes: '',
    adminNotes: '',
    tableId: '',
  });

  // Reject-with-reason dialog (row action + in-modal action share it)
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Generic confirm dialog (cancel / no-show — no reason collected)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const emptyCreateForm = useMemo(
    () => ({
      source: 'PHONE' as 'PHONE' | 'WALKIN',
      date: today,
      startTime: '',
      customTime: false,
      duration: 90,
      guestCount: 2,
      tableId: '',
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      notes: '',
      adminNotes: '',
    }),
    [today],
  );
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [createError, setCreateError] = useState('');

  // 300ms debounced search
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebouncedSearch(searchInput);
      setCurrentPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // --- list query: one call, params driven by the active view tab ---
  const listParams = useMemo(() => {
    if (viewTab === 'pending') {
      return {
        dateFrom: today,
        status: ReservationStatus.PENDING,
        search: debouncedSearch || undefined,
        page: currentPage,
        limit: PAGE_SIZE,
      };
    }
    if (viewTab === 'upcoming') {
      // Whole 14-day window in one shot; counts + selected-day list are
      // derived client-side (server already sorts date asc, startTime asc).
      return { dateFrom: today, dateTo: addDays(today, UPCOMING_DAYS), limit: 500 };
    }
    return {
      date: selectedDate,
      status: statusFilter === 'ALL' ? undefined : statusFilter,
      search: debouncedSearch || undefined,
      page: currentPage,
      limit: PAGE_SIZE,
    };
  }, [viewTab, today, selectedDate, statusFilter, debouncedSearch, currentPage]);

  const { data: paginatedData, isLoading } = useReservations(listParams);
  const rows = paginatedData?.data;
  const meta = paginatedData?.meta;

  const { data: stats } = useReservationStats(selectedDate);
  const { data: settings } = useReservationSettings();
  const { data: pendingCountData } = usePendingReservationCount();
  const { data: tables } = useTables();
  const pendingCount = pendingCountData?.count ?? 0;

  const defaultDuration = settings?.defaultDuration ?? 90;

  // --- create-modal availability (public endpoints, gated on modal open) ---
  const createEndTime =
    createForm.startTime && addMinutesToTime(createForm.startTime, createForm.duration || defaultDuration);
  const { data: createSlots } = useAvailableSlots(
    createOpen ? tenantId : '',
    createForm.date,
    createForm.guestCount,
    branchId ?? undefined,
  );
  const { data: createTables } = useAvailableTables(
    createOpen ? tenantId : '',
    createForm.date,
    createForm.startTime,
    createEndTime || '',
    createForm.guestCount,
    branchId ?? undefined,
  );

  // --- detail-modal availability: which tables are free for the edited window ---
  const { data: detailTables } = useAvailableTables(
    detailModalOpen ? tenantId : '',
    edit.date,
    edit.startTime,
    edit.endTime,
    edit.guestCount,
    branchId ?? undefined,
  );
  const detailFreeIds = useMemo(
    () => new Set((detailTables ?? []).map((tb) => tb.id)),
    [detailTables],
  );

  // Mutations
  const { mutate: confirmReservation, isPending: isConfirming } = useConfirmReservation();
  const { mutate: rejectReservation, isPending: isRejecting } = useRejectReservation();
  const { mutate: seatReservation, isPending: isSeating } = useSeatReservation();
  const { mutate: completeReservation, isPending: isCompleting } = useCompleteReservation();
  const { mutate: noShowReservation, isPending: isMarkingNoShow } = useNoShowReservation();
  const { mutate: cancelReservation, isPending: isCancelling } = useCancelReservation();
  const { mutate: updateReservation, isPending: isUpdating } = useUpdateReservation();
  const { mutate: createReservation, isPending: isCreating } = useCreateReservation();

  const isActionPending =
    isConfirming || isRejecting || isSeating || isCompleting || isMarkingNoShow || isCancelling;

  // --- upcoming view derivations ---
  const upcomingRows = useMemo(
    () => (viewTab === 'upcoming' ? rows ?? [] : []),
    [viewTab, rows],
  );
  const upcomingDays = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of upcomingRows) {
      const k = dateKey(r.date);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return Array.from({ length: UPCOMING_DAYS + 1 }, (_, i) => {
      const d = addDays(today, i);
      return { date: d, count: counts.get(d) ?? 0 };
    });
  }, [upcomingRows, today]);
  const upcomingDayList = useMemo(
    () => upcomingRows.filter((r) => dateKey(r.date) === selectedUpcomingDay),
    [upcomingRows, selectedUpcomingDay],
  );

  // --- handlers ---
  const changeView = (tab: ViewTab) => {
    setViewTab(tab);
    setCurrentPage(1);
  };
  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    setCurrentPage(1);
  };
  const handleStatusChange = (status: StatusFilter) => {
    setStatusFilter((prev) => (prev === status ? 'ALL' : status));
    setCurrentPage(1);
  };

  const showConfirmDialog = (title: string, message: string, onConfirm: () => void) =>
    setConfirmDialog({ open: true, title, message, onConfirm });
  const closeConfirmDialog = () =>
    setConfirmDialog({ open: false, title: '', message: '', onConfirm: () => {} });
  const handleConfirmDialogAction = () => {
    confirmDialog.onConfirm();
    closeConfirmDialog();
  };

  const handleCancel = (id: string) =>
    showConfirmDialog(
      t('reservations:actions.cancel'),
      t('reservations:confirmDialog.cancelMessage'),
      () => cancelReservation(id),
    );
  const handleNoShow = (id: string) =>
    showConfirmDialog(
      t('reservations:actions.noShow'),
      t('reservations:confirmDialog.noShowMessage'),
      () => noShowReservation(id),
    );

  const openReject = (id: string) => {
    setRejectTarget(id);
    setRejectReason('');
  };
  const submitReject = () => {
    if (!rejectTarget) return;
    rejectReservation(
      { id: rejectTarget, rejectionReason: rejectReason.trim() || undefined },
      {
        onSuccess: () => {
          setRejectTarget(null);
          // If we rejected from the detail modal, close it too.
          if (selectedReservation?.id === rejectTarget) setDetailModalOpen(false);
        },
      },
    );
  };

  const handleViewDetail = (reservation: Reservation) => {
    setSelectedReservation(reservation);
    setEdit({
      date: dateKey(reservation.date),
      startTime: formatTime(reservation.startTime),
      endTime: formatTime(reservation.endTime),
      guestCount: reservation.guestCount,
      customerName: reservation.customerName,
      customerPhone: reservation.customerPhone || '',
      customerEmail: reservation.customerEmail || '',
      notes: reservation.notes || '',
      adminNotes: reservation.adminNotes || '',
      tableId: reservation.tableId || '',
    });
    setDetailModalOpen(true);
  };

  const handleSaveDetails = () => {
    if (!selectedReservation) return;
    updateReservation(
      {
        id: selectedReservation.id,
        data: {
          date: edit.date,
          startTime: edit.startTime,
          endTime: edit.endTime,
          guestCount: edit.guestCount,
          customerName: edit.customerName,
          customerPhone: edit.customerPhone || undefined,
          customerEmail: edit.customerEmail || undefined,
          notes: edit.notes || undefined,
          adminNotes: edit.adminNotes || undefined,
          tableId: edit.tableId || undefined,
        },
      },
      { onSuccess: () => setDetailModalOpen(false) },
    );
  };

  const openCreate = () => {
    setCreateForm({ ...emptyCreateForm, duration: defaultDuration, date: selectedDate || today });
    setCreateError('');
    setCreateOpen(true);
  };

  const handleCreateSubmit = () => {
    setCreateError('');
    if (!createForm.customerName.trim()) {
      setCreateError(t('reservations:create.nameRequired'));
      return;
    }
    if (!createForm.startTime) {
      setCreateError(t('reservations:create.timeRequired'));
      return;
    }
    if (createForm.source === 'WALKIN' && !createForm.tableId) {
      setCreateError(t('reservations:create.walkinTableRequired'));
      return;
    }
    if (
      createForm.source === 'PHONE' &&
      !createForm.customerPhone.trim() &&
      !createForm.customerEmail.trim()
    ) {
      setCreateError(t('reservations:create.contactRequired'));
      return;
    }
    const payload: CreateStaffReservationDto = {
      date: createForm.date,
      startTime: createForm.startTime,
      endTime: addMinutesToTime(createForm.startTime, createForm.duration || defaultDuration),
      guestCount: createForm.guestCount,
      customerName: createForm.customerName.trim(),
      customerPhone: createForm.customerPhone.trim() || undefined,
      customerEmail: createForm.customerEmail.trim() || undefined,
      notes: createForm.notes.trim() || undefined,
      adminNotes: createForm.adminNotes.trim() || undefined,
      tableId: createForm.tableId || undefined,
      branchId: branchId ?? undefined,
      source: createForm.source,
      autoSeat: createForm.source === 'WALKIN' ? true : undefined,
    };
    createReservation(payload, { onSuccess: () => setCreateOpen(false) });
  };

  // Status badge configuration
  const getStatusBadge = (status: ReservationStatus) => {
    switch (status) {
      case ReservationStatus.PENDING:
        return { variant: 'warning' as const, label: t('reservations:status.PENDING') };
      case ReservationStatus.CONFIRMED:
        return { variant: 'info' as const, label: t('reservations:status.CONFIRMED') };
      case ReservationStatus.REJECTED:
        return { variant: 'danger' as const, label: t('reservations:status.REJECTED') };
      case ReservationStatus.SEATED:
        return { variant: 'success' as const, label: t('reservations:status.SEATED') };
      case ReservationStatus.COMPLETED:
        return { variant: 'default' as const, label: t('reservations:status.COMPLETED') };
      case ReservationStatus.CANCELLED:
        return { variant: 'danger' as const, label: t('reservations:status.CANCELLED') };
      case ReservationStatus.NO_SHOW:
        return { variant: 'warning' as const, label: t('reservations:status.NO_SHOW') };
      default:
        return { variant: 'default' as const, label: String(status) };
    }
  };

  // Status filter tabs (adds REJECTED + NO_SHOW)
  const statusTabs: { value: StatusFilter; label: string }[] = useMemo(
    () => [
      { value: 'ALL', label: t('reservations:filters.all') },
      { value: ReservationStatus.PENDING, label: t('reservations:filters.pending') },
      { value: ReservationStatus.CONFIRMED, label: t('reservations:filters.confirmed') },
      { value: ReservationStatus.SEATED, label: t('reservations:filters.seated') },
      { value: ReservationStatus.COMPLETED, label: t('reservations:filters.completed') },
      { value: ReservationStatus.CANCELLED, label: t('reservations:filters.cancelled') },
      { value: ReservationStatus.REJECTED, label: t('reservations:filters.rejected') },
      { value: ReservationStatus.NO_SHOW, label: t('reservations:filters.noShow') },
    ],
    [t],
  );

  // Clickable stat cards → status filter
  const statCards = [
    {
      key: 'ALL' as StatusFilter,
      label: t('reservations:stats.total'),
      value: stats?.total ?? 0,
      icon: CalendarDays,
      gradient: 'bg-gradient-to-br from-primary-500 to-primary-600',
      textColor: 'text-primary-700',
    },
    {
      key: ReservationStatus.PENDING as StatusFilter,
      label: t('reservations:stats.pending'),
      value: stats?.pending ?? 0,
      icon: Clock,
      gradient: 'bg-gradient-to-br from-amber-500 to-amber-600',
      textColor: 'text-amber-700',
    },
    {
      key: ReservationStatus.CONFIRMED as StatusFilter,
      label: t('reservations:stats.confirmed'),
      value: stats?.confirmed ?? 0,
      icon: CheckCircle,
      gradient: 'bg-gradient-to-br from-blue-500 to-blue-600',
      textColor: 'text-blue-700',
    },
    {
      key: ReservationStatus.SEATED as StatusFilter,
      label: t('reservations:stats.seated'),
      value: stats?.seated ?? 0,
      icon: Users,
      gradient: 'bg-gradient-to-br from-emerald-500 to-emerald-600',
      textColor: 'text-emerald-700',
    },
  ];

  const viewTabs: { value: ViewTab; label: string; icon: typeof CalendarDays; badge?: number }[] = [
    { value: 'day', label: t('reservations:views.day'), icon: CalendarDays },
    { value: 'pending', label: t('reservations:views.pending'), icon: Inbox, badge: pendingCount },
    { value: 'upcoming', label: t('reservations:views.upcoming'), icon: CalendarRange },
  ];

  // Inline lifecycle action buttons for a table row.
  const rowActions = (reservation: Reservation) => (
    <div className="flex items-center justify-end gap-1.5">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => handleViewDetail(reservation)}
        title={t('reservations:actions.view')}
      >
        <Eye className="h-4 w-4" />
      </Button>

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
            onClick={() => openReject(reservation.id)}
            disabled={isActionPending}
            title={t('reservations:actions.reject')}
          >
            <UserX className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-slate-500 hover:bg-slate-100 hover:text-slate-600"
            onClick={() => handleCancel(reservation.id)}
            disabled={isActionPending}
            title={t('reservations:actions.cancel')}
          >
            <Ban className="h-4 w-4" />
          </Button>
        </>
      )}

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
            onClick={() => handleCancel(reservation.id)}
            disabled={isActionPending}
            title={t('reservations:actions.cancel')}
          >
            <Ban className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-amber-600 hover:bg-amber-50 hover:text-amber-700"
            onClick={() => handleNoShow(reservation.id)}
            disabled={isActionPending}
            title={t('reservations:actions.noShow')}
          >
            <AlertTriangle className="h-4 w-4" />
          </Button>
        </>
      )}

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
  );

  // Shared reservations table (list view for Gün / Bekleyenler / Yaklaşan).
  const reservationsTable = (list: Reservation[], showDate: boolean) => (
    <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              {showDate && (
                <th className="text-start px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  {t('reservations:table.date')}
                </th>
              )}
              <th className="text-start px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {t('reservations:table.time')}
              </th>
              <th className="text-start px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {t('reservations:table.customer')}
              </th>
              <th className="text-start px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {t('reservations:table.guests')}
              </th>
              <th className="text-start px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {t('reservations:table.table')}
              </th>
              <th className="text-start px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {t('reservations:table.status')}
              </th>
              <th className="text-end px-6 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                {t('reservations:table.actions')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {list.map((reservation) => {
              const statusBadge = getStatusBadge(reservation.status);
              return (
                <tr key={reservation.id} className="hover:bg-slate-50/50 transition-colors duration-150">
                  {showDate && (
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-slate-900">
                        {formatDate(reservation.date, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                    </td>
                  )}
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-slate-400" />
                      <span className="text-sm font-medium text-slate-900">
                        {formatTime(reservation.startTime)}
                      </span>
                      <span className="text-xs text-slate-400">-</span>
                      <span className="text-sm text-slate-500">{formatTime(reservation.endTime)}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div>
                      <p className="text-sm font-medium text-slate-900">{reservation.customerName}</p>
                      <p className="text-xs text-slate-500">{reservation.customerPhone}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-slate-400" />
                      <span className="text-sm text-slate-700">{reservation.guestCount}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-slate-700">
                      {reservation.table
                        ? `${t('reservations:table.tablePrefix')} ${reservation.table.number}`
                        : t('reservations:table.unassigned')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <Badge variant={statusBadge.variant} size="sm">
                      {statusBadge.label}
                    </Badge>
                  </td>
                  <td className="px-6 py-4">{rowActions(reservation)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const emptyState = (title: string, description: string) => (
    <div className="bg-white rounded-2xl border border-slate-200/60 py-16 text-center">
      <div className="mx-auto w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <CalendarDays className="w-10 h-10 text-slate-400" />
      </div>
      <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-500 max-w-sm mx-auto">{description}</p>
    </div>
  );

  return (
    <FeatureGate feature="reservationSystem">
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-shrink-0 flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
              <CalendarDays className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="font-heading font-bold text-slate-900 text-2xl">
                {t('reservations:title')}
              </h1>
              <p className="text-slate-500 mt-0.5">{t('reservations:description')}</p>
            </div>
          </div>
          <Button onClick={openCreate} data-testid="new-reservation-btn">
            <Plus className="w-4 h-4 me-1.5" />
            {t('reservations:create.button')}
          </Button>
        </div>

        {/* View Tabs */}
        <div className="flex gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
          {viewTabs.map((tab) => {
            const Icon = tab.icon;
            const active = viewTab === tab.value;
            return (
              <button
                key={tab.value}
                data-testid={`viewtab-${tab.value}`}
                onClick={() => changeView(tab.value)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all duration-200 ${
                  active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.badge ? (
                  <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-amber-500 text-white text-xs font-bold">
                    {tab.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* ============================= DAY VIEW ============================= */}
        {viewTab === 'day' && (
          <>
            {/* Date strip */}
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDateChange(addDays(selectedDate, -1))}
                  title={t('reservations:day.previous')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  aria-label={t('reservations:filters.date')}
                  className="px-3.5 py-2 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 hover:border-slate-300 transition-all duration-200"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleDateChange(addDays(selectedDate, 1))}
                  title={t('reservations:day.next')}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                {selectedDate !== today && (
                  <Button variant="ghost" size="sm" onClick={() => handleDateChange(today)}>
                    {t('reservations:day.today')}
                  </Button>
                )}
              </div>

              <div className="relative w-full sm:w-72">
                <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder={t('reservations:filters.searchPlaceholder')}
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full ps-9 pe-3.5 py-2 border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 hover:border-slate-300 transition-all duration-200"
                />
              </div>
            </div>

            {/* Clickable stat cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {statCards.map((stat) => {
                const Icon = stat.icon;
                const active = statusFilter === stat.key;
                return (
                  <button
                    key={stat.key}
                    type="button"
                    onClick={() => handleStatusChange(stat.key)}
                    className={`text-start bg-white rounded-2xl border p-5 transition-all duration-300 hover:shadow-md ${
                      active ? 'border-primary-400 ring-2 ring-primary-500/20' : 'border-slate-200/60'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className={`w-10 h-10 rounded-xl ${stat.gradient} flex items-center justify-center shadow-lg`}>
                        <Icon className="w-5 h-5 text-white" />
                      </div>
                      <span className={`text-2xl font-bold ${stat.textColor}`}>{stat.value}</span>
                    </div>
                    <p className="text-sm text-slate-500 font-medium">{stat.label}</p>
                  </button>
                );
              })}
            </div>

            {/* Status filter tabs */}
            <div className="flex gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
              {statusTabs.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => handleStatusChange(tab.value)}
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

            {isLoading ? (
              <div className="flex justify-center py-16">
                <Spinner />
              </div>
            ) : !rows || rows.length === 0 ? (
              emptyState(
                t('reservations:table.noReservations'),
                t('reservations:table.noReservationsDescription'),
              )
            ) : (
              <div className="space-y-0">
                {reservationsTable(rows, false)}
                {meta && meta.totalPages > 1 && (
                  <div className="flex items-center justify-between px-6 py-4 bg-white rounded-b-2xl border border-t-0 border-slate-200/60">
                    <p className="text-sm text-slate-500">
                      {t('reservations:pagination.showing', {
                        from: (meta.page - 1) * meta.limit + 1,
                        to: Math.min(meta.page * meta.limit, meta.total),
                        total: meta.total,
                      })}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm text-slate-600 px-2">
                        {meta.page} / {meta.totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.min(meta.totalPages, p + 1))}
                        disabled={currentPage === meta.totalPages}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* =========================== PENDING VIEW =========================== */}
        {viewTab === 'pending' && (
          <>
            <div className="relative w-full sm:w-72">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder={t('reservations:filters.searchPlaceholder')}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full ps-9 pe-3.5 py-2 border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 hover:border-slate-300 transition-all duration-200"
              />
            </div>

            {isLoading ? (
              <div className="flex justify-center py-16">
                <Spinner />
              </div>
            ) : !rows || rows.length === 0 ? (
              emptyState(
                t('reservations:pending.empty'),
                t('reservations:pending.emptyDescription'),
              )
            ) : (
              <div className="space-y-3">
                {rows.map((reservation) => (
                  <div
                    key={reservation.id}
                    data-testid="pending-row"
                    className="bg-white rounded-2xl border border-slate-200/60 p-4 flex flex-col sm:flex-row sm:items-center gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex flex-col items-center justify-center w-16 flex-shrink-0 text-center">
                        <span className="text-xs font-semibold text-amber-600 uppercase">
                          {formatDate(reservation.date, { month: 'short', day: 'numeric' })}
                        </span>
                        <span className="text-sm font-bold text-slate-900">
                          {formatTime(reservation.startTime)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">
                          {reservation.customerName}
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          {reservation.customerPhone || reservation.customerEmail}
                          {' · '}
                          {reservation.guestCount} {t('reservations:detail.people')}
                          {reservation.table
                            ? ` · ${t('reservations:table.tablePrefix')} ${reservation.table.number}`
                            : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleViewDetail(reservation)}
                        title={t('reservations:actions.view')}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => confirmReservation(reservation.id)}
                        disabled={isActionPending}
                      >
                        <UserCheck className="h-4 w-4 me-1.5" />
                        {t('reservations:actions.confirm')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => openReject(reservation.id)}
                        disabled={isActionPending}
                      >
                        <UserX className="h-4 w-4 me-1.5" />
                        {t('reservations:actions.reject')}
                      </Button>
                    </div>
                  </div>
                ))}
                {/* Pending can span many future days — page through them all so
                    the inbox never hides requests the badge is still counting. */}
                {meta && meta.totalPages > 1 && (
                  <div className="flex items-center justify-between px-2 py-2">
                    <p className="text-sm text-slate-500">
                      {t('reservations:pagination.showing', {
                        from: (meta.page - 1) * meta.limit + 1,
                        to: Math.min(meta.page * meta.limit, meta.total),
                        total: meta.total,
                      })}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm text-slate-600 px-2">
                        {meta.page} / {meta.totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.min(meta.totalPages, p + 1))}
                        disabled={currentPage === meta.totalPages}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* =========================== UPCOMING VIEW ========================== */}
        {viewTab === 'upcoming' && (
          <>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {upcomingDays.map((day) => {
                const active = day.date === selectedUpcomingDay;
                return (
                  <button
                    key={day.date}
                    onClick={() => setSelectedUpcomingDay(day.date)}
                    className={`flex flex-col items-center justify-center min-w-[4.5rem] px-3 py-2.5 rounded-xl border transition-all ${
                      active
                        ? 'bg-primary-500 border-primary-500 text-white shadow-sm'
                        : 'bg-white border-slate-200/60 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <span className="text-[11px] uppercase font-medium opacity-80">
                      {formatDate(day.date, { weekday: 'short' })}
                    </span>
                    <span className="text-lg font-bold leading-tight">
                      {formatDate(day.date, { day: 'numeric' })}
                    </span>
                    <span
                      className={`mt-1 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full text-xs font-semibold ${
                        active ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {day.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {isLoading ? (
              <div className="flex justify-center py-16">
                <Spinner />
              </div>
            ) : upcomingDayList.length === 0 ? (
              emptyState(
                t('reservations:upcoming.empty'),
                t('reservations:upcoming.emptyDescription'),
              )
            ) : (
              reservationsTable(upcomingDayList, false)
            )}
          </>
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

              {/* Editable core fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('reservations:detail.editDate')}
                  </label>
                  <input
                    type="date"
                    value={edit.date}
                    onChange={(e) => setEdit((s) => ({ ...s, date: e.target.value }))}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('reservations:detail.editGuests')}
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={edit.guestCount}
                    onChange={(e) => setEdit((s) => ({ ...s, guestCount: Number(e.target.value) }))}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('reservations:detail.editStartTime')}
                  </label>
                  <input
                    type="time"
                    value={edit.startTime}
                    onChange={(e) => setEdit((s) => ({ ...s, startTime: e.target.value }))}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('reservations:detail.editEndTime')}
                  </label>
                  <input
                    type="time"
                    value={edit.endTime}
                    onChange={(e) => setEdit((s) => ({ ...s, endTime: e.target.value }))}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('reservations:detail.editName')}
                  </label>
                  <input
                    type="text"
                    value={edit.customerName}
                    onChange={(e) => setEdit((s) => ({ ...s, customerName: e.target.value }))}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('reservations:detail.editPhone')}
                  </label>
                  <input
                    type="tel"
                    value={edit.customerPhone}
                    onChange={(e) => setEdit((s) => ({ ...s, customerPhone: e.target.value }))}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('reservations:detail.editEmail')}
                  </label>
                  <input
                    type="email"
                    value={edit.customerEmail}
                    onChange={(e) => setEdit((s) => ({ ...s, customerEmail: e.target.value }))}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('reservations:detail.assignTable')}
                  </label>
                  <select
                    value={edit.tableId}
                    onChange={(e) => setEdit((s) => ({ ...s, tableId: e.target.value }))}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  >
                    <option value="">{t('reservations:detail.noTable')}</option>
                    {tables?.map((table) => {
                      const capacityFits = table.capacity >= edit.guestCount;
                      const isCurrent = table.id === selectedReservation.tableId;
                      // Disable a table when the availability probe (for the
                      // edited window) says it's taken — unless it's the one
                      // already assigned to THIS reservation.
                      const conflicting =
                        edit.startTime && edit.endTime && !detailFreeIds.has(table.id) && !isCurrent;
                      const disabled = (!capacityFits && !isCurrent) || !!conflicting;
                      return (
                        <option key={table.id} value={table.id} disabled={disabled}>
                          {t('reservations:table.tablePrefix')} {table.number} ({table.capacity}{' '}
                          {t('reservations:detail.seats')})
                          {conflicting ? ` — ${t('reservations:detail.tableConflict')}` : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>

              {/* Guest notes */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {t('reservations:detail.guestNotes')}
                </label>
                <textarea
                  value={edit.notes}
                  onChange={(e) => setEdit((s) => ({ ...s, notes: e.target.value }))}
                  rows={2}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none"
                />
              </div>

              {/* Admin notes */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {t('reservations:detail.adminNotes')}
                </label>
                <textarea
                  value={edit.adminNotes}
                  onChange={(e) => setEdit((s) => ({ ...s, adminNotes: e.target.value }))}
                  rows={2}
                  placeholder={t('reservations:detail.adminNotesPlaceholder')}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none"
                />
              </div>

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

              {/* In-modal lifecycle actions */}
              <div className="border-t border-slate-100 pt-4">
                <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-2">
                  {t('reservations:detail.lifecycleActions')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedReservation.status === ReservationStatus.PENDING && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => confirmReservation(selectedReservation.id)}
                        disabled={isActionPending}
                      >
                        <UserCheck className="h-4 w-4 me-1.5" />
                        {t('reservations:actions.confirm')}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => openReject(selectedReservation.id)}
                        disabled={isActionPending}
                      >
                        <UserX className="h-4 w-4 me-1.5" />
                        {t('reservations:actions.reject')}
                      </Button>
                    </>
                  )}
                  {selectedReservation.status === ReservationStatus.CONFIRMED && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => seatReservation(selectedReservation.id)}
                        disabled={isActionPending}
                      >
                        <LogIn className="h-4 w-4 me-1.5" />
                        {t('reservations:actions.seat')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleNoShow(selectedReservation.id)}
                        disabled={isActionPending}
                      >
                        <AlertTriangle className="h-4 w-4 me-1.5" />
                        {t('reservations:actions.noShow')}
                      </Button>
                    </>
                  )}
                  {selectedReservation.status === ReservationStatus.SEATED && (
                    <Button
                      size="sm"
                      onClick={() => completeReservation(selectedReservation.id)}
                      disabled={isActionPending}
                    >
                      <CheckSquare className="h-4 w-4 me-1.5" />
                      {t('reservations:actions.complete')}
                    </Button>
                  )}
                  {(selectedReservation.status === ReservationStatus.PENDING ||
                    selectedReservation.status === ReservationStatus.CONFIRMED) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCancel(selectedReservation.id)}
                      disabled={isActionPending}
                    >
                      <Ban className="h-4 w-4 me-1.5" />
                      {t('reservations:actions.cancel')}
                    </Button>
                  )}
                </div>
              </div>

              {/* Timestamps */}
              <div className="border-t border-slate-100 pt-4">
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <p>
                    {t('reservations:detail.createdAt')}:{' '}
                    {new Date(selectedReservation.createdAt).toLocaleString(lng)}
                  </p>
                  {selectedReservation.confirmedAt && (
                    <p>
                      {t('reservations:detail.confirmedAt')}:{' '}
                      {new Date(selectedReservation.confirmedAt).toLocaleString(lng)}
                    </p>
                  )}
                  {selectedReservation.seatedAt && (
                    <p>
                      {t('reservations:detail.seatedAt')}:{' '}
                      {new Date(selectedReservation.seatedAt).toLocaleString(lng)}
                    </p>
                  )}
                  {selectedReservation.completedAt && (
                    <p>
                      {t('reservations:detail.completedAt')}:{' '}
                      {new Date(selectedReservation.completedAt).toLocaleString(lng)}
                    </p>
                  )}
                  {selectedReservation.cancelledAt && (
                    <p>
                      {t('reservations:detail.cancelledAt')}:{' '}
                      {new Date(selectedReservation.cancelledAt).toLocaleString(lng)}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setDetailModalOpen(false)}
                >
                  {t('common:app.cancel')}
                </Button>
                <Button type="button" className="flex-1" onClick={handleSaveDetails} isLoading={isUpdating}>
                  {t('common:app.save')}
                </Button>
              </div>
            </div>
          )}
        </Modal>

        {/* Create Modal */}
        <Modal
          isOpen={createOpen}
          onClose={() => setCreateOpen(false)}
          title={t('reservations:create.title')}
          size="lg"
        >
          <div className="space-y-5">
            {/* Source toggle */}
            <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
              {(['PHONE', 'WALKIN'] as const).map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setCreateForm((s) => ({ ...s, source: src }))}
                  className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    createForm.source === src
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {src === 'PHONE'
                    ? t('reservations:create.sourcePhone')
                    : t('reservations:create.sourceWalkin')}
                </button>
              ))}
            </div>
            {createForm.source === 'WALKIN' && (
              <p className="text-xs text-slate-500 -mt-2">{t('reservations:create.walkinHint')}</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {t('reservations:create.date')}
                </label>
                <input
                  type="date"
                  value={createForm.date}
                  onChange={(e) =>
                    setCreateForm((s) => ({ ...s, date: e.target.value, startTime: '', tableId: '' }))
                  }
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {t('reservations:create.guests')}
                </label>
                <input
                  type="number"
                  min={1}
                  value={createForm.guestCount}
                  onChange={(e) =>
                    setCreateForm((s) => ({ ...s, guestCount: Number(e.target.value), tableId: '' }))
                  }
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {t('reservations:create.duration')}
                </label>
                <input
                  type="number"
                  min={15}
                  step={15}
                  value={createForm.duration}
                  onChange={(e) => setCreateForm((s) => ({ ...s, duration: Number(e.target.value) }))}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-sm font-medium text-slate-700">
                    {t('reservations:create.time')}
                  </label>
                  <button
                    type="button"
                    onClick={() => setCreateForm((s) => ({ ...s, customTime: !s.customTime, startTime: '' }))}
                    className="text-xs text-primary-600 hover:text-primary-700"
                  >
                    {createForm.customTime
                      ? t('reservations:create.useSlots')
                      : t('reservations:create.customTime')}
                  </button>
                </div>
                {createForm.customTime ? (
                  <input
                    type="time"
                    value={createForm.startTime}
                    aria-label={t('reservations:create.time')}
                    onChange={(e) => setCreateForm((s) => ({ ...s, startTime: e.target.value, tableId: '' }))}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  />
                ) : (
                  <select
                    value={createForm.startTime}
                    onChange={(e) => setCreateForm((s) => ({ ...s, startTime: e.target.value, tableId: '' }))}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                  >
                    <option value="">{t('reservations:create.selectTime')}</option>
                    {(createSlots ?? [])
                      .filter((slot) => slot.available)
                      .map((slot) => (
                        <option key={slot.time} value={slot.time}>
                          {formatTime(slot.time)}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            </div>

            {/* Table select — only free capacity-fitting tables for the window */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('reservations:create.table')}
                {createForm.source === 'WALKIN' && <span className="text-red-500"> *</span>}
              </label>
              <select
                value={createForm.tableId}
                onChange={(e) => setCreateForm((s) => ({ ...s, tableId: e.target.value }))}
                disabled={!createForm.startTime}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">
                  {createForm.source === 'WALKIN'
                    ? t('reservations:create.selectTable')
                    : t('reservations:create.anyTable')}
                </option>
                {(createTables ?? []).map((table) => (
                  <option key={table.id} value={table.id}>
                    {t('reservations:table.tablePrefix')} {table.number} ({table.capacity}{' '}
                    {t('reservations:detail.seats')})
                  </option>
                ))}
              </select>
              {createForm.startTime && (createTables ?? []).length === 0 && (
                <p className="text-xs text-amber-600 mt-1">{t('reservations:create.noFreeTables')}</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {t('reservations:create.name')}
                  <span className="text-red-500"> *</span>
                </label>
                <input
                  type="text"
                  value={createForm.customerName}
                  aria-label={t('reservations:create.name')}
                  onChange={(e) => setCreateForm((s) => ({ ...s, customerName: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {t('reservations:create.phone')}
                </label>
                <input
                  type="tel"
                  value={createForm.customerPhone}
                  aria-label={t('reservations:create.phone')}
                  onChange={(e) => setCreateForm((s) => ({ ...s, customerPhone: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {t('reservations:create.email')}
                </label>
                <input
                  type="email"
                  value={createForm.customerEmail}
                  onChange={(e) => setCreateForm((s) => ({ ...s, customerEmail: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  {t('reservations:create.notes')}
                </label>
                <input
                  type="text"
                  value={createForm.notes}
                  onChange={(e) => setCreateForm((s) => ({ ...s, notes: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
                />
              </div>
            </div>

            {createForm.source === 'PHONE' && (
              <p className="text-xs text-slate-500">{t('reservations:create.contactRequired')}</p>
            )}

            {createError && (
              <div
                data-testid="create-error"
                className="bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5"
              >
                <p className="text-sm text-red-700">{createError}</p>
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setCreateOpen(false)}>
                {t('common:app.cancel')}
              </Button>
              <Button
                type="button"
                className="flex-1"
                data-testid="create-submit"
                onClick={handleCreateSubmit}
                isLoading={isCreating}
              >
                {t('reservations:create.submit')}
              </Button>
            </div>
          </div>
        </Modal>

        {/* Reject-with-reason Modal */}
        <Modal
          isOpen={rejectTarget !== null}
          onClose={() => setRejectTarget(null)}
          title={t('reservations:reject.title')}
          size="sm"
        >
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                {t('reservations:reject.reasonLabel')}
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder={t('reservations:reject.reasonPlaceholder')}
                className="w-full px-3.5 py-2.5 border border-slate-200 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 resize-none"
              />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setRejectTarget(null)}>
                {t('common:app.cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                className="flex-1"
                data-testid="reject-submit"
                onClick={submitReject}
                isLoading={isRejecting}
              >
                {t('reservations:reject.submit')}
              </Button>
            </div>
          </div>
        </Modal>

        {/* Generic confirm dialog (cancel / no-show) */}
        <Modal
          isOpen={confirmDialog.open}
          onClose={closeConfirmDialog}
          title={confirmDialog.title}
          size="sm"
        >
          <div className="space-y-6">
            <p className="text-sm text-slate-600">{confirmDialog.message}</p>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={closeConfirmDialog}>
                {t('common:app.cancel')}
              </Button>
              <Button type="button" variant="danger" className="flex-1" onClick={handleConfirmDialogAction}>
                {t('common:app.confirm')}
              </Button>
            </div>
          </div>
        </Modal>
      </div>
    </FeatureGate>
  );
};

export default ReservationsPage;

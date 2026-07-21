import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Edit,
  Trash2,
  Lock,
  AlertTriangle,
  LayoutGrid,
  Users,
  Clock,
  Map as MapIcon,
  List as ListIcon,
  Pencil,
} from 'lucide-react';
import {
  useTables,
  useCreateTable,
  useUpdateTable,
  useDeleteTable,
  useUpdateTableStatus,
} from '../../features/tables/tablesApi';
import LiveFloorMap from '../../features/floor-plan/components/LiveFloorMap';
import FloorPlanEditorPage from './FloorPlanEditorPage';
import { useFloorPlan } from '../../features/floor-plan/floorPlanApi';
import { useFloorEditorStore } from '../../features/floor-plan/floorEditorStore';
import {
  parseTableViewMode,
  serializeTableViewMode,
  type TableViewMode,
} from './tableViewMode';
import { CreateTableDto, Table, TableStatus } from '../../types';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import FormSelect from '../../components/ui/FormSelect';
import Spinner from '../../components/ui/Spinner';
import { useSubscription } from '../../contexts/SubscriptionContext';
import UpgradePrompt from '../../components/subscriptions/UpgradePrompt';
import {
  getTableStatusConfig,
  getTableStatusLabel,
} from '../../lib/tableStatus';

/** Occupancy stats strip — same useTables()-derived totals, rendered in
 *  BOTH plan and list modes (the plan view previously had no numbers). */
const TableStatsStrip = ({
  stats,
}: {
  stats: {
    total: number;
    available: number;
    occupied: number;
    reserved: number;
    occupancyPct: number;
  };
}) => {
  const { t } = useTranslation('common');
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
      <div className="bg-white rounded-2xl border border-slate-200/60 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
            <LayoutGrid className="w-5 h-5 text-slate-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
            <p className="text-xs text-slate-500">{t('admin.totalTables')}</p>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200/60 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <span className="w-3 h-3 rounded-full bg-emerald-500" />
          </div>
          <div>
            <p className="text-2xl font-bold text-emerald-600">{stats.available}</p>
            <p className="text-xs text-slate-500">{t('admin.available')}</p>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200/60 p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center">
            <span className="w-3 h-3 rounded-full bg-red-500" />
          </div>
          <div>
            <p className="text-2xl font-bold text-red-600">{stats.occupied}</p>
            <p className="text-xs text-slate-500">{t('admin.occupied')}</p>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200/60 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <span className="w-3 h-3 rounded-full bg-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-600">{stats.reserved}</p>
              <p className="text-xs text-slate-500">{t('admin.reserved')}</p>
            </div>
          </div>
          {/* Occupancy % indicator */}
          <div className="text-right">
            <p className="text-2xl font-bold text-slate-900">{stats.occupancyPct}%</p>
            <p className="text-xs text-slate-500">{t('admin.occupancy')}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

const TableManagementPage = () => {
  const { t } = useTranslation(['common', 'subscriptions']);
  const { checkLimit } = useSubscription();

  const tableSchema = z.object({
    number: z.string().min(1, t('admin.tableNumberRequired')),
    // Upper bound mirrors the floor-plan editor's clamp — a 4-digit typo
    // here used to create a giant table the plan couldn't render sanely.
    capacity: z
      .number()
      .min(1, t('admin.capacityRange'))
      .max(200, t('admin.capacityRange')),
    status: z.nativeEnum(TableStatus),
    // '' = unplaced (no zoneId sent). Only rendered while creating.
    zoneId: z.string().optional(),
  });

  type TableFormData = z.infer<typeof tableSchema>;
  // Masalar üç modda açılır — 'plan' (canlı 2D salon planı, VARSAYILAN) staff'ın
  // masaları görsel olarak gördüğü mod; 'edit' salon planı düzenleyicisi (eski
  // ayrı /admin/floor-plan sekmesi buraya taşındı); 'list' klasik kart ızgarası.
  // Mod URL'de yaşar (?view=edit|list) — yenileme/deep-link/back güvenli.
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseTableViewMode(searchParams.get('view'));
  // Mode requested while the floor editor holds unsaved work — kept until
  // the user confirms discarding (null when the guard dialog is closed).
  const [pendingView, setPendingView] = useState<TableViewMode | null>(null);
  const editorDirty = useFloorEditorStore((s) => s.dirty);

  const applyView = (mode: TableViewMode) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const serialized = serializeTableViewMode(mode);
        if (serialized === null) next.delete('view');
        else next.set('view', serialized);
        return next;
      },
      // replace: mode flips are not navigations — keep the back button sane.
      { replace: true },
    );
  };

  const requestView = (mode: TableViewMode) => {
    if (mode !== view && view === 'edit' && editorDirty) {
      setPendingView(mode);
      return;
    }
    applyView(mode);
  };
  // Table tapped on the live plan → opens the quick status action sheet. We hold
  // only the id and re-derive the live row from the (socket-refreshed) plan, so
  // the sheet's status/active-state can't go stale while it's open.
  const [statusTargetId, setStatusTargetId] = useState<string | null>(null);
  const { data: livePlan } = useFloorPlan();
  const statusTarget = statusTargetId
    ? (livePlan?.zones
        .flatMap((z) => z.tables)
        .concat(livePlan?.unplacedTables ?? [])
        .find((tbl) => tbl.id === statusTargetId) ?? null)
    : null;
  const statusTargetZoneName =
    (statusTarget?.zoneId &&
      livePlan?.zones.find((z) => z.id === statusTarget.zoneId)?.name) ||
    null;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<Table | null>(null);
  // Styled delete confirmation replaces the native confirm(); holds the
  // table pending deletion (null when the dialog is closed).
  const [tableToDelete, setTableToDelete] = useState<Table | null>(null);

  const { data: tables, isLoading } = useTables();
  const { mutate: createTable } = useCreateTable();
  const { mutate: updateTable } = useUpdateTable();
  const { mutate: deleteTable, isPending: isDeleting } = useDeleteTable();
  const { mutate: updateTableStatus, isPending: isUpdatingStatus } =
    useUpdateTableStatus();

  // Check table limit
  const tableLimit = checkLimit('maxTables', tables?.length ?? 0);
  const canAddTable = tableLimit.allowed;

  // Calculate statistics
  const stats = useMemo(() => {
    if (!tables)
      return { total: 0, available: 0, occupied: 0, reserved: 0, occupancyPct: 0 };
    const total = tables.length;
    const occupied = tables.filter((t) => t.status === TableStatus.OCCUPIED).length;
    return {
      total,
      available: tables.filter((t) => t.status === TableStatus.AVAILABLE).length,
      occupied,
      reserved: tables.filter((t) => t.status === TableStatus.RESERVED).length,
      // Occupancy = share of tables currently seated. 0 when no tables.
      occupancyPct: total === 0 ? 0 : Math.round((occupied / total) * 100),
    };
  }, [tables]);

  const form = useForm<TableFormData>({
    resolver: zodResolver(tableSchema),
    defaultValues: {
      status: TableStatus.AVAILABLE,
    },
  });

  const handleOpenModal = (table?: Table) => {
    if (table) {
      setEditingTable(table);
      form.reset({
        number: table.number,
        capacity: table.capacity,
        status: table.status as TableStatus,
      });
    } else {
      setEditingTable(null);
      form.reset({
        number: '',
        capacity: 4,
        status: TableStatus.AVAILABLE,
        // Default to the first zone so a new table lands VISIBLE on the
        // default plan view instead of silently in the unplaced tray.
        zoneId: livePlan?.zones[0]?.id ?? '',
      });
    }
    setModalOpen(true);
  };

  const handleSubmit = (data: TableFormData) => {
    const { zoneId, ...rest } = data;
    const submitData: CreateTableDto = {
      ...rest,
      capacity: Number(rest.capacity),
      status: rest.status as TableStatus,
    };
    if (!editingTable && zoneId) {
      const zone = livePlan?.zones.find((z) => z.id === zoneId);
      if (zone) {
        // Drop at the zone's center with a ±40px jitter so consecutive
        // creates don't stack invisibly on the exact same point.
        submitData.zoneId = zone.id;
        submitData.posX = Math.round(
          zone.canvasWidth / 2 + (Math.random() - 0.5) * 80,
        );
        submitData.posY = Math.round(
          zone.canvasHeight / 2 + (Math.random() - 0.5) * 80,
        );
      }
    }

    if (editingTable) {
      updateTable(
        { id: editingTable.id, data: submitData },
        {
          onSuccess: () => {
            setModalOpen(false);
            form.reset();
          },
        }
      );
    } else {
      createTable(submitData, {
        onSuccess: () => {
          setModalOpen(false);
          form.reset();
        },
      });
    }
  };

  const statusOptions = [
    { value: TableStatus.AVAILABLE, label: t('admin.available') },
    { value: TableStatus.OCCUPIED, label: t('admin.occupied') },
    { value: TableStatus.RESERVED, label: t('admin.reserved') },
  ];

  // Zone choices for the create modal — '' keeps the unplaced behavior.
  const zoneOptions = [
    ...(livePlan?.zones ?? []).map((z) => ({ value: z.id, label: z.name })),
    { value: '', label: t('admin.zoneUnplaced') },
  ];

  // One-tap status control: the segmented Free/Seated/Reserved order
  // used on every card. Mirrors statusOptions but as a flat array.
  const oneTapStatuses = [
    TableStatus.AVAILABLE,
    TableStatus.OCCUPIED,
    TableStatus.RESERVED,
  ];

  const handleConfirmDelete = () => {
    if (!tableToDelete) return;
    deleteTable(tableToDelete.id, {
      onSuccess: () => setTableToDelete(null),
    });
  };

  return (
    <div className="space-y-6">
      {/* Page Header. `flex-wrap` lets the right-side action cluster
          drop to a second row on narrow viewports — without it the
          fixed-width icon + title kept the row at desktop width and
          pushed the "Add Table" button off-screen on mobile. The
          gap modifier keeps the wrapped layout visually clean. */}
      <div className="flex flex-wrap items-center justify-between gap-3 md:gap-4">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
            <LayoutGrid className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="font-heading font-bold text-slate-900 text-2xl">
              {t('admin.tableManagement')}
            </h1>
            <p className="text-slate-500 mt-0.5">{t('admin.manageTablesSeating')}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Salon Planı / Düzenle / Liste mode switcher. Floor-plan editor is
              folded in here (was a separate /admin/floor-plan tab). */}
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            <button
              type="button"
              onClick={() => requestView('plan')}
              className={`flex items-center gap-1.5 px-3 h-9 rounded-md text-sm transition-colors ${view === 'plan' ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:text-slate-700'}`}
              aria-pressed={view === 'plan'}
            >
              <MapIcon className="w-4 h-4" /> {t('admin.viewPlan', 'Salon Planı')}
            </button>
            <button
              type="button"
              onClick={() => requestView('edit')}
              className={`flex items-center gap-1.5 px-3 h-9 rounded-md text-sm transition-colors ${view === 'edit' ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:text-slate-700'}`}
              aria-pressed={view === 'edit'}
            >
              <Pencil className="w-4 h-4" /> {t('admin.viewEdit', 'Düzenle')}
            </button>
            <button
              type="button"
              onClick={() => requestView('list')}
              className={`flex items-center gap-1.5 px-3 h-9 rounded-md text-sm transition-colors ${view === 'list' ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:text-slate-700'}`}
              aria-pressed={view === 'list'}
            >
              <ListIcon className="w-4 h-4" /> {t('admin.viewList', 'Liste')}
            </button>
          </div>
          {/* The editor mode has its own "add table" affordance in its toolbar —
              hide the page-level button there to avoid two competing controls. */}
          {view !== 'edit' && (
            <Button onClick={() => handleOpenModal()} disabled={!canAddTable}>
              {canAddTable ? (
                <Plus className="h-4 w-4 mr-2" />
              ) : (
                <Lock className="h-4 w-4 mr-2" />
              )}
              {t('admin.addTable')}
            </Button>
          )}
        </div>
      </div>

      {/* Limit Info Banner — hidden in the editor workspace */}
      {view !== 'edit' && tableLimit.limit !== -1 && (
        <div
          className={`rounded-xl px-6 py-4 flex items-start gap-3 ${
            canAddTable
              ? 'bg-blue-50 border border-blue-200'
              : 'bg-amber-50 border border-amber-200'
          }`}
        >
          <AlertTriangle
            className={`h-5 w-5 mt-0.5 ${canAddTable ? 'text-blue-600' : 'text-amber-600'}`}
          />
          <div>
            <h3
              className={`font-semibold ${canAddTable ? 'text-blue-900' : 'text-amber-900'}`}
            >
              {t('admin.tables')}: {tables?.length ?? 0} / {tableLimit.limit}
            </h3>
            <p
              className={`text-sm ${canAddTable ? 'text-blue-700' : 'text-amber-700'}`}
            >
              {canAddTable
                ? t('admin.tableLimitInfo')
                : t('subscriptions:subscriptions.limitReachedDescription', {
                    resource: t('subscriptions:subscriptions.planLimits.tables'),
                    current: tables?.length ?? 0,
                    limit: tableLimit.limit,
                  })}
            </p>
          </div>
        </div>
      )}

      {/* Upgrade Prompt when limit reached */}
      {view !== 'edit' && !canAddTable && (
        <UpgradePrompt
          limitType="maxTables"
          currentCount={tables?.length ?? 0}
          limit={tableLimit.limit}
        />
      )}

      {/* Stats strip — shared status palette + live occupancy %, rendered
          in BOTH plan and list modes (the plan is the default screen staff
          glance at). Hidden while empty/loading and in the editor. */}
      {view !== 'edit' && !isLoading && tables && tables.length > 0 && (
        <TableStatsStrip stats={stats} />
      )}

      {/* Main Content */}
      {view === 'edit' ? (
        /* Salon planı düzenleyicisi — eski ayrı /admin/floor-plan sekmesi buraya
           gömüldü. Kendi araç çubuğu, bölge sekmeleri ve kaydet düğmesi var. */
        <FloorPlanEditorPage embedded />
      ) : view === 'plan' ? (
        /* Live 2D floor map — same plan as the editor, with real-time status.
           Tapping a table opens the quick status action sheet. The map drives
           its OWN useFloorPlan loading; don't gate it on the tables-list query. */
        <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden h-[72vh]">
          <LiveFloorMap
            onTableClick={(tbl) => setStatusTargetId(tbl.id)}
            emptyAction={
              <Button onClick={() => requestView('edit')}>
                <MapIcon className="h-4 w-4 mr-2" />
                {t('admin.openFloorPlanEditor', 'Salon planını düzenle')}
              </Button>
            }
          />
        </div>
      ) : isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : !tables || tables.length === 0 ? (
        /* Empty State */
        <div className="bg-white rounded-2xl border border-slate-200/60 py-16 text-center">
          <div className="mx-auto w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
            <LayoutGrid className="w-10 h-10 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900">{t('admin.noTables')}</h3>
          <p className="mt-2 text-sm text-slate-500 max-w-sm mx-auto">
            {t('admin.noTablesDescription')}
          </p>
          <Button className="mt-6" onClick={() => handleOpenModal()} disabled={!canAddTable}>
            <Plus className="h-4 w-4 mr-2" />
            {t('admin.addFirstTable')}
          </Button>
        </div>
      ) : (
        /* Table Cards Grid */
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {tables?.map((table) => {
            const statusConfig = getTableStatusConfig(table.status);
            const StatusIcon = statusConfig.icon;
            const statusLabel = getTableStatusLabel(table.status, t);

            return (
              <div
                key={table.id}
                className="group relative bg-white rounded-2xl border border-slate-200/60 p-5 hover:shadow-lg hover:border-primary-200 transition-all duration-300"
              >
                {/* Status indicator bar at top */}
                <div
                  className={`absolute top-0 left-4 right-4 h-1 rounded-b-full ${statusConfig.barGradient}`}
                />

                {/* Table visual representation */}
                <div
                  className={`mx-auto w-20 h-20 rounded-xl flex items-center justify-center mb-4 ${statusConfig.gradient} shadow-lg`}
                >
                  <span className="text-3xl font-bold text-white">{table.number}</span>
                </div>

                {/* Status badge */}
                <div className="text-center mb-3">
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusConfig.lightBg}`}
                  >
                    <StatusIcon className="w-3.5 h-3.5" />
                    {statusLabel}
                  </span>
                </div>

                {/* Capacity */}
                <div className="flex items-center justify-center gap-1.5 text-slate-600 mb-4">
                  <Users className="w-4 h-4" />
                  <span className="text-sm">
                    {table.capacity} {t('admin.people')}
                  </span>
                </div>

                {/* One-tap status — segmented Free/Seated/Reserved.
                    Wires the previously-unused useUpdateTableStatus hook
                    so staff can flip status instantly without opening the
                    edit modal. Active segment uses the shared palette. */}
                <div
                  className="mb-4 grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1"
                  role="group"
                  aria-label={t('admin.status')}
                >
                  {oneTapStatuses.map((status) => {
                    const isActive = table.status === status;
                    const cfg = getTableStatusConfig(status);
                    return (
                      <button
                        key={status}
                        type="button"
                        disabled={isUpdatingStatus || isActive}
                        aria-pressed={isActive}
                        onClick={() => {
                          if (isActive) return;
                          updateTableStatus({ id: table.id, status });
                        }}
                        className={`rounded-md py-1.5 text-[11px] font-semibold transition-all ${
                          isActive
                            ? `text-white ${cfg.gradient} shadow-sm`
                            : 'text-slate-600 hover:bg-white hover:text-slate-900 disabled:opacity-50'
                        }`}
                      >
                        {getTableStatusLabel(status, t)}
                      </button>
                    );
                  })}
                </div>

                {/* Upcoming reservation badge — surfaces the next
                    CONFIRMED/PENDING booking starting within ~2 h so
                    staff can see at a glance which tables have an
                    imminent guest. Rendered above the action buttons
                    so it's always visible (no hover required). */}
                {table.upcomingReservation && (
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <div className="flex items-center gap-1.5 font-medium">
                      <Clock className="h-3.5 w-3.5" />
                      <span>{table.upcomingReservation.startTime}</span>
                      <span className="text-amber-700">·</span>
                      <span className="truncate">{table.upcomingReservation.customerName}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-amber-700">
                      {table.upcomingReservation.guestCount} {t('admin.people')} · {table.upcomingReservation.status}
                    </div>
                  </div>
                )}

                {/* Actions — always visible on touch/small viewports
                    (the old opacity-0 group-hover hid them entirely on
                    touch, where there is no hover). Hover-reveal is kept
                    only for pointer devices from lg up. */}
                <div className="flex gap-2 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity duration-200">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    aria-label={t('admin.editTable')}
                    onClick={() => handleOpenModal(table)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:bg-red-50 hover:text-red-600"
                    aria-label={t('app.delete')}
                    onClick={() => setTableToDelete(table)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingTable ? t('admin.editTable') : t('admin.addTable')}
      >
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <Input
            label={t('admin.tableNumber')}
            placeholder={t('admin.tableNumberPlaceholder')}
            maxLength={32}
            error={form.formState.errors.number?.message}
            {...form.register('number')}
          />
          <Input
            label={t('admin.capacity')}
            type="number"
            min="1"
            max="200"
            error={form.formState.errors.capacity?.message}
            {...form.register('capacity', { valueAsNumber: true })}
          />
          <FormSelect
            label={t('admin.status')}
            options={statusOptions}
            error={form.formState.errors.status?.message}
            {...form.register('status')}
          />
          {/* Zone placement — create only (editing keeps the table where it
              is; moving zones is the floor editor's job). Defaulting to the
              first zone means a new table lands VISIBLE on the plan. */}
          {!editingTable &&
            (livePlan?.zones.length ? (
              <FormSelect
                label={t('admin.tableZone')}
                options={zoneOptions}
                error={form.formState.errors.zoneId?.message}
                {...form.register('zoneId')}
              />
            ) : (
              <p className="text-xs text-slate-500">{t('admin.noZonesHint')}</p>
            ))}
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setModalOpen(false)}
            >
              {t('app.cancel')}
            </Button>
            <Button type="submit" className="flex-1">
              {editingTable ? t('app.update') : t('app.create')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Styled delete confirmation — replaces the native confirm().
          Shows the table number and warns when the table is occupied or
          has an upcoming reservation (deleting would orphan a seated
          guest / a booked slot). */}
      <Modal
        isOpen={!!tableToDelete}
        onClose={() => setTableToDelete(null)}
        title={t('admin.deleteTable')}
      >
        {tableToDelete && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="text-sm text-slate-700">
                  {t('admin.deleteTableConfirm')}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {t('admin.table')} {tableToDelete.number}
                </p>
              </div>
            </div>

            {/* Occupied warning */}
            {tableToDelete.status === TableStatus.OCCUPIED && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{t('admin.deleteOccupiedWarning')}</span>
              </div>
            )}

            {/* Upcoming reservation warning */}
            {tableToDelete.upcomingReservation && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <Clock className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  {t('admin.deleteReservationWarning')}
                  : {tableToDelete.upcomingReservation.startTime} ·{' '}
                  {tableToDelete.upcomingReservation.customerName}
                </span>
              </div>
            )}

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => setTableToDelete(null)}
              >
                {t('app.cancel')}
              </Button>
              <Button
                type="button"
                variant="danger"
                className="flex-1"
                isLoading={isDeleting}
                onClick={handleConfirmDelete}
              >
                {t('app.delete')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Quick status action sheet — opened by tapping a table on the live
          plan. Sets the table status (the map recolors via socket/invalidate). */}
      <Modal
        isOpen={!!statusTarget}
        onClose={() => setStatusTargetId(null)}
        title={
          statusTarget
            ? t('admin.tableNumberLabel', { number: statusTarget.number })
            : ''
        }
        size="sm"
      >
        {statusTarget && (
          <div className="space-y-3">
            {/* Info line — capacity + zone, so the sheet answers "which
                table is this?" without leaving the plan. */}
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <Users className="w-4 h-4 text-slate-400" />
                {statusTarget.capacity} {t('admin.people')}
              </span>
              <span className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1.5">
                <MapIcon className="w-4 h-4 text-slate-400" />
                {statusTargetZoneName ?? t('admin.zoneUnplaced')}
              </span>
            </div>
            <p className="text-sm text-slate-500">{t('admin.setStatus', 'Durumu değiştir')}</p>
            <div className="grid grid-cols-1 gap-2">
              {(Object.values(TableStatus) as TableStatus[]).map((s) => {
                const cfg = getTableStatusConfig(s);
                const Icon = cfg.icon;
                const active = statusTarget.status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    // Already-active status is a no-op — disable it (mirrors the
                    // list-card segments) so a "confirm" tap doesn't fire a
                    // redundant write + cross-terminal invalidation.
                    disabled={isUpdatingStatus || active}
                    onClick={() => {
                      if (active) return;
                      updateTableStatus(
                        { id: statusTarget.id, status: s },
                        { onSuccess: () => setStatusTargetId(null) },
                      );
                    }}
                    className={`flex items-center gap-2.5 h-11 px-4 rounded-xl border text-sm transition-colors ${
                      active
                        ? `${cfg.chip} font-medium`
                        : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                    } ${isUpdatingStatus ? 'opacity-50' : ''}`}
                  >
                    <Icon className="w-4 h-4" />
                    {getTableStatusLabel(s, t)}
                    {active && <span className="ml-auto text-xs">✓</span>}
                  </button>
                );
              })}
            </div>
            {/* Full edit (number/capacity/status) — reuses the list-mode
                modal. The full Table row comes from the tables cache; the
                plan payload alone doesn't carry everything the form edits.
                Disabled if the row isn't in the cache (still loading). */}
            {(() => {
              const row = tables?.find((tbl) => tbl.id === statusTarget.id);
              return (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={!row}
                  onClick={() => {
                    if (!row) return;
                    setStatusTargetId(null);
                    handleOpenModal(row);
                  }}
                >
                  <Edit className="h-4 w-4 mr-2" />
                  {t('admin.editTable')}
                </Button>
              );
            })()}
          </div>
        )}
      </Modal>

      {/* Leaving-edit guard — switching away from the editor with unsaved
          floor-plan changes needs an explicit choice (discard vs stay).
          Mirrors the styled-confirm pattern of the delete modal above. */}
      <Modal
        isOpen={!!pendingView}
        onClose={() => setPendingView(null)}
        title={t('admin.unsavedChangesTitle')}
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
            <p className="text-sm text-slate-700">{t('admin.unsavedChangesBody')}</p>
          </div>
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setPendingView(null)}
            >
              {t('admin.stayInEditor')}
            </Button>
            <Button
              type="button"
              variant="danger"
              className="flex-1"
              onClick={() => {
                if (pendingView) applyView(pendingView);
                setPendingView(null);
              }}
            >
              {t('admin.discardAndLeave')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default TableManagementPage;

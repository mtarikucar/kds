import { useState, useMemo, lazy, Suspense } from 'react';
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
  CheckCircle,
  Clock,
  XCircle,
  Box,
  Grid3X3,
} from 'lucide-react';
import {
  useTables,
  useCreateTable,
  useUpdateTable,
  useDeleteTable,
} from '../../features/tables/tablesApi';
import { Table, TableStatus } from '../../types';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import FormSelect from '../../components/ui/FormSelect';
import Spinner from '../../components/ui/Spinner';
import { useSubscription } from '../../contexts/SubscriptionContext';
import UpgradePrompt from '../../components/subscriptions/UpgradePrompt';
import { useAuthStore } from '../../store/authStore';

const VoxelWorldView = lazy(() =>
  import('../../features/voxel-world').then((mod) => ({
    default: mod.VoxelWorldView,
  }))
);

type ViewMode = 'grid' | 'voxel';

const TableManagementPage = () => {
  const { t } = useTranslation(['common', 'subscriptions']);
  const { checkLimit } = useSubscription();
  const user = useAuthStore((state) => state.user);

  const tableSchema = z.object({
    number: z.string().min(1, t('admin.tableNumberRequired')),
    capacity: z.number().min(1, t('admin.capacityMin')),
    status: z.nativeEnum(TableStatus),
  });

  type TableFormData = z.infer<typeof tableSchema>;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<Table | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const { data: tables, isLoading } = useTables();
  const { mutate: createTable } = useCreateTable();
  const { mutate: updateTable } = useUpdateTable();
  const { mutate: deleteTable } = useDeleteTable();

  // Check table limit
  const tableLimit = checkLimit('maxTables', tables?.length ?? 0);
  const canAddTable = tableLimit.allowed;

  // Calculate statistics
  const stats = useMemo(() => {
    if (!tables) return { total: 0, available: 0, occupied: 0, reserved: 0 };
    return {
      total: tables.length,
      available: tables.filter((t) => t.status === TableStatus.AVAILABLE).length,
      occupied: tables.filter((t) => t.status === TableStatus.OCCUPIED).length,
      reserved: tables.filter((t) => t.status === TableStatus.RESERVED).length,
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
      });
    }
    setModalOpen(true);
  };

  const handleSubmit = (data: TableFormData) => {
    const submitData = {
      ...data,
      capacity: Number(data.capacity),
      status: data.status as TableStatus,
    };

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

  const getStatusConfig = (status: TableStatus) => {
    switch (status) {
      case TableStatus.AVAILABLE:
        return {
          variant: 'success' as const,
          label: t('admin.available'),
          icon: CheckCircle,
          gradient: 'bg-gradient-to-br from-emerald-500 to-emerald-600',
          lightBg: 'bg-emerald-50',
          barGradient: 'bg-gradient-to-r from-emerald-400 to-emerald-500',
        };
      case TableStatus.OCCUPIED:
        return {
          variant: 'danger' as const,
          label: t('admin.occupied'),
          icon: XCircle,
          gradient: 'bg-gradient-to-br from-red-500 to-red-600',
          lightBg: 'bg-red-50',
          barGradient: 'bg-gradient-to-r from-red-400 to-red-500',
        };
      case TableStatus.RESERVED:
        return {
          variant: 'warning' as const,
          label: t('admin.reserved'),
          icon: Clock,
          gradient: 'bg-gradient-to-br from-amber-500 to-amber-600',
          lightBg: 'bg-amber-50',
          barGradient: 'bg-gradient-to-r from-amber-400 to-amber-500',
        };
      default:
        return {
          variant: 'default' as const,
          label: String(status),
          icon: CheckCircle,
          gradient: 'bg-gradient-to-br from-slate-500 to-slate-600',
          lightBg: 'bg-slate-50',
          barGradient: 'bg-gradient-to-r from-slate-400 to-slate-500',
        };
    }
  };

  return (
    <div className={viewMode === 'voxel' ? 'flex flex-col h-full gap-4' : 'space-y-6'}>
      {/* Page Header */}
      <div className="flex flex-shrink-0 items-center justify-between">
        <div className="flex items-center gap-4">
          {viewMode === 'grid' && (
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
              <LayoutGrid className="w-7 h-7 text-white" />
            </div>
          )}
          <div>
            <h1 className={`font-heading font-bold text-slate-900 ${viewMode === 'voxel' ? 'text-lg' : 'text-2xl'}`}>
              {t('admin.tableManagement')}
            </h1>
            {viewMode === 'grid' && (
              <p className="text-slate-500 mt-0.5">{t('admin.manageTablesSeating')}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* View Mode Toggle */}
          <div className="flex rounded-lg bg-slate-100 p-1" data-tour="view-toggle">
            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                viewMode === 'grid'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Grid3X3 className="h-4 w-4" />
              <span className="hidden sm:inline">{t('admin.gridView')}</span>
            </button>
            <button
              onClick={() => setViewMode('voxel')}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                viewMode === 'voxel'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Box className="h-4 w-4" />
              <span className="hidden sm:inline">{t('admin.floorPlan')}</span>
            </button>
          </div>

          {viewMode === 'grid' && (
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

      {/* Limit Info Banner (hidden in voxel mode) */}
      {viewMode === 'grid' && tableLimit.limit !== -1 && (
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
                ? t('admin.subscriptionLimitInfo')
                : t('subscriptions:subscriptions.limitReachedDescription', {
                    resource: t('subscriptions:subscriptions.planLimits.tables'),
                    current: tables?.length ?? 0,
                    limit: tableLimit.limit,
                  })}
            </p>
          </div>
        </div>
      )}

      {/* Upgrade Prompt when limit reached (hidden in voxel mode) */}
      {viewMode === 'grid' && !canAddTable && (
        <UpgradePrompt
          limitType="maxTables"
          currentCount={tables?.length ?? 0}
          limit={tableLimit.limit}
        />
      )}


      {/* Main Content */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Spinner />
        </div>
      ) : viewMode === 'voxel' ? (
        /* 3D Voxel Floor Plan View */
        <div className="flex-1 min-h-0" data-tour="floor-plan-3d">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
              <div className="flex flex-col items-center gap-3">
                <Box className="h-12 w-12 animate-pulse text-primary" />
                <span className="text-sm text-slate-500">Loading 3D View...</span>
              </div>
            </div>
          }
        >
          <VoxelWorldView
            tables={tables ?? []}
            tenantId={user?.tenantId ?? undefined}
            onTableClick={(tableId) => {
              const table = tables?.find((t) => t.id === tableId);
              if (table) handleOpenModal(table);
            }}
          />
        </Suspense>
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
            const statusConfig = getStatusConfig(table.status as TableStatus);
            const StatusIcon = statusConfig.icon;

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
                    {statusConfig.label}
                  </span>
                </div>

                {/* Capacity */}
                <div className="flex items-center justify-center gap-1.5 text-slate-600 mb-4">
                  <Users className="w-4 h-4" />
                  <span className="text-sm">
                    {table.capacity} {t('admin.people')}
                  </span>
                </div>

                {/* Actions - visible on hover */}
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleOpenModal(table)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:bg-red-50 hover:text-red-600"
                    onClick={() => {
                      if (confirm(t('admin.deleteTableConfirm'))) {
                        deleteTable(table.id);
                      }
                    }}
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
            error={form.formState.errors.number?.message}
            {...form.register('number')}
          />
          <Input
            label={t('admin.capacity')}
            type="number"
            min="1"
            error={form.formState.errors.capacity?.message}
            {...form.register('capacity', { valueAsNumber: true })}
          />
          <FormSelect
            label={t('admin.status')}
            options={statusOptions}
            error={form.formState.errors.status?.message}
            {...form.register('status')}
          />
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
    </div>
  );
};

export default TableManagementPage;

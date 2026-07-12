import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  Video,
  Plus,
  Pencil,
  Trash2,
  Crosshair,
  Wifi,
  WifiOff,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/Card';
import Button from '../../../components/ui/Button';
import Input from '../../../components/ui/Input';
import FormSelect from '../../../components/ui/FormSelect';
import Modal from '../../../components/ui/Modal';
import Spinner from '../../../components/ui/Spinner';
import EmptyState from '../../../components/ui/EmptyState';
import ErrorState from '../../../components/ui/ErrorState';
import {
  useCameras,
  useCameraHealth,
  useCreateCamera,
  useUpdateCamera,
  useDeleteCamera,
} from '../analyticsApi';
import { Camera, CameraStatus } from '../types';
import CameraCalibration from './CameraCalibration';

// Matches the backend CameraStreamType enum (analytics.enum.ts).
const STREAM_TYPES = ['RTSP', 'ONVIF', 'HLS', 'WEBRTC'] as const;

// Calibration maps camera pixels onto the occupancy grid; the analytics
// backend works on a 20×20 m default floor extent (heatmap gridWidth ×
// cellSize). Kept as a constant until per-branch floor-plan dimensions
// are exposed to this screen.
const FLOOR_PLAN_SIZE_METERS = 20;

interface CameraFormValues {
  name: string;
  description: string;
  streamUrl: string;
  streamType: string;
}

const STATUS_STYLES: Record<CameraStatus, string> = {
  [CameraStatus.ONLINE]: 'bg-green-100 text-green-800',
  [CameraStatus.OFFLINE]: 'bg-slate-100 text-slate-600',
  [CameraStatus.ERROR]: 'bg-red-100 text-red-800',
  [CameraStatus.CALIBRATING]: 'bg-blue-100 text-blue-800',
};

const CameraManagement = () => {
  const { t } = useTranslation(['analytics', 'common']);

  const camerasQuery = useCameras();
  const healthQuery = useCameraHealth();
  const createCamera = useCreateCamera();
  const updateCamera = useUpdateCamera();
  const deleteCamera = useDeleteCamera();

  const [formOpen, setFormOpen] = useState(false);
  const [editingCamera, setEditingCamera] = useState<Camera | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Camera | null>(null);
  const [calibrateTarget, setCalibrateTarget] = useState<Camera | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CameraFormValues>({
    defaultValues: { name: '', description: '', streamUrl: '', streamType: 'RTSP' },
  });

  const openCreate = () => {
    setEditingCamera(null);
    reset({ name: '', description: '', streamUrl: '', streamType: 'RTSP' });
    setFormOpen(true);
  };

  const openEdit = (camera: Camera) => {
    setEditingCamera(camera);
    reset({
      name: camera.name,
      description: camera.description ?? '',
      streamUrl: camera.streamUrl,
      streamType: camera.streamType || 'RTSP',
    });
    setFormOpen(true);
  };

  const onSubmit = async (values: CameraFormValues) => {
    const payload = {
      name: values.name.trim(),
      description: values.description.trim() || undefined,
      streamUrl: values.streamUrl.trim(),
      streamType: values.streamType,
    };
    try {
      if (editingCamera) {
        await updateCamera.mutateAsync({ id: editingCamera.id, data: payload });
        toast.success(t('analytics:cameras.updated'));
      } else {
        await createCamera.mutateAsync(payload);
        toast.success(t('analytics:cameras.created'));
      }
      setFormOpen(false);
    } catch {
      toast.error(
        editingCamera
          ? t('analytics:cameras.updateFailed')
          : t('analytics:cameras.createFailed'),
      );
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteCamera.mutateAsync(deleteTarget.id);
      toast.success(t('analytics:cameras.deleted'));
      setDeleteTarget(null);
    } catch {
      toast.error(t('analytics:cameras.deleteFailed'));
    }
  };

  const cameras = camerasQuery.data ?? [];
  const health = healthQuery.data;
  const saving = createCamera.isPending || updateCamera.isPending;

  if (camerasQuery.isLoading) {
    return <Spinner />;
  }

  if (camerasQuery.isError) {
    return (
      <Card>
        <CardContent>
          <ErrorState
            error={camerasQuery.error}
            onRetry={() => camerasQuery.refetch()}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Health summary */}
      {cameras.length > 0 && health && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-full bg-slate-500">
                  <Video className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">{t('analytics:cameras.health.total')}</p>
                  <p className="text-xl font-bold">{health.total}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-full bg-green-500">
                  <Wifi className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">{t('analytics:cameras.health.online')}</p>
                  <p className="text-xl font-bold">{health.online}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-full bg-slate-400">
                  <WifiOff className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">{t('analytics:cameras.health.offline')}</p>
                  <p className="text-xl font-bold">{health.offline}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-full bg-red-500">
                  <AlertTriangle className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">{t('analytics:cameras.health.error')}</p>
                  <p className="text-xl font-bold">{health.error}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-full bg-blue-500">
                  <Loader2 className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">{t('analytics:cameras.health.calibrating')}</p>
                  <p className="text-xl font-bold">{health.calibrating}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Camera list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <Video className="h-5 w-5 text-slate-500" />
              {t('analytics:cameras.title')}
            </CardTitle>
            {cameras.length > 0 && (
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" />
                {t('analytics:cameras.add')}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {cameras.length === 0 ? (
            <EmptyState
              icon={Video}
              title={t('analytics:cameras.emptyTitle')}
              description={t('analytics:cameras.emptyDescription')}
              actionLabel={t('analytics:cameras.add')}
              onAction={openCreate}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-4">{t('analytics:cameras.columns.name')}</th>
                    <th className="text-left py-3 px-4">{t('analytics:cameras.columns.location')}</th>
                    <th className="text-left py-3 px-4">{t('analytics:cameras.columns.status')}</th>
                    <th className="text-left py-3 px-4">{t('analytics:cameras.columns.lastSeen')}</th>
                    <th className="text-right py-3 px-4">{t('analytics:cameras.columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {cameras.map((camera) => (
                    <tr key={camera.id} className="border-b hover:bg-slate-50">
                      <td className="py-3 px-4 font-medium">{camera.name}</td>
                      <td className="py-3 px-4 text-slate-500">{camera.description || '-'}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            STATUS_STYLES[camera.status] ?? STATUS_STYLES[CameraStatus.OFFLINE]
                          }`}
                        >
                          {t(`analytics:cameras.statusValues.${camera.status}`, {
                            defaultValue: camera.status,
                          })}
                        </span>
                        {camera.status === CameraStatus.ERROR && camera.errorMessage && (
                          <p className="text-xs text-red-600 mt-1">{camera.errorMessage}</p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-500">
                        {camera.lastSeenAt
                          ? format(new Date(camera.lastSeenAt), 'dd.MM.yyyy HH:mm')
                          : t('analytics:cameras.neverSeen')}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setCalibrateTarget(camera)}
                            className="p-2 hover:bg-blue-50 rounded-lg transition-colors text-blue-600"
                            title={t('analytics:cameras.calibrate')}
                            aria-label={t('analytics:cameras.calibrate')}
                          >
                            <Crosshair className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openEdit(camera)}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-600"
                            title={t('common:app.edit')}
                            aria-label={t('common:app.edit')}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(camera)}
                            className="p-2 hover:bg-red-50 rounded-lg transition-colors text-red-600"
                            title={t('common:app.delete')}
                            aria-label={t('common:app.delete')}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create / edit modal */}
      <Modal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        title={
          editingCamera
            ? t('analytics:cameras.editTitle')
            : t('analytics:cameras.addTitle')
        }
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Input
            label={t('analytics:cameras.form.name')}
            placeholder={t('analytics:cameras.form.namePlaceholder')}
            error={errors.name?.message}
            {...register('name', {
              required: t('analytics:cameras.form.nameRequired'),
            })}
          />
          <Input
            label={t('analytics:cameras.form.location')}
            placeholder={t('analytics:cameras.form.locationPlaceholder')}
            {...register('description')}
          />
          <Input
            label={t('analytics:cameras.form.streamUrl')}
            placeholder="rtsp://user:pass@192.168.1.100:554/stream1"
            hint={t('analytics:cameras.form.streamUrlHint')}
            error={errors.streamUrl?.message}
            {...register('streamUrl', {
              required: t('analytics:cameras.form.streamUrlRequired'),
            })}
          />
          <FormSelect
            label={t('analytics:cameras.form.streamType')}
            options={STREAM_TYPES.map((type) => ({ value: type, label: type }))}
            {...register('streamType')}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setFormOpen(false)}>
              {t('common:app.cancel')}
            </Button>
            <Button type="submit" isLoading={saving}>
              {editingCamera ? t('common:app.save') : t('analytics:cameras.add')}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={t('analytics:cameras.deleteTitle')}
        size="sm"
      >
        <p className="text-sm text-slate-600">
          {t('analytics:cameras.deleteConfirm', { name: deleteTarget?.name ?? '' })}
        </p>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            {t('common:app.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            isLoading={deleteCamera.isPending}
          >
            {t('common:app.delete')}
          </Button>
        </div>
      </Modal>

      {/* Calibration modal */}
      <Modal
        isOpen={!!calibrateTarget}
        onClose={() => setCalibrateTarget(null)}
        size="xl"
      >
        {calibrateTarget && (
          <CameraCalibration
            cameraId={calibrateTarget.id}
            streamUrl={calibrateTarget.streamUrl}
            floorPlanWidth={FLOOR_PLAN_SIZE_METERS}
            floorPlanHeight={FLOOR_PLAN_SIZE_METERS}
            onCalibrationComplete={() => {
              toast.success(t('analytics:cameras.calibrationSaved'));
            }}
            onCancel={() => setCalibrateTarget(null)}
          />
        )}
      </Modal>
    </div>
  );
};

export default CameraManagement;
export { CameraManagement };

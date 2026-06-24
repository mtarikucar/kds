import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import { FloorZone, FloorZoneKind, UpdateFloorZoneDto } from '../../../types';

interface Props {
  zone: FloorZone;
  isOpen: boolean;
  onClose: () => void;
  onSave: (dto: UpdateFloorZoneDto) => void;
  onDelete: () => void;
  saving?: boolean;
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block">
    <span className="text-xs text-slate-500 mb-1 block">{label}</span>
    {children}
  </label>
);
const inputCls = 'w-full h-9 px-2.5 rounded-lg border border-slate-200 text-sm focus:border-primary-400 focus:outline-none';

export default function ZoneSettingsModal({ zone, isOpen, onClose, onSave, onDelete, saving }: Props) {
  const { t } = useTranslation(['floorPlan', 'common']);
  const [name, setName] = useState(zone.name);
  const [kind, setKind] = useState<FloorZoneKind>(zone.kind);
  const [canvasWidth, setCanvasWidth] = useState(zone.canvasWidth);
  const [canvasHeight, setCanvasHeight] = useState(zone.canvasHeight);
  const [gridSize, setGridSize] = useState(zone.gridSize);
  const [backgroundImageUrl, setBg] = useState(zone.backgroundImageUrl ?? '');
  const [backgroundOpacity, setOpacity] = useState(zone.backgroundOpacity);

  const submit = () => {
    onSave({
      name: name.trim(),
      kind,
      canvasWidth,
      canvasHeight,
      gridSize,
      backgroundImageUrl: backgroundImageUrl.trim() || undefined,
      backgroundOpacity,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('floorPlan:zoneSettings')} size="md">
      <div className="space-y-4">
        <Field label={t('floorPlan:zone.name')}>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </Field>
        <Field label={t('floorPlan:zone.kind')}>
          <div className="grid grid-cols-2 gap-2">
            {[FloorZoneKind.INDOOR, FloorZoneKind.OUTDOOR].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={['h-9 rounded-lg border text-sm', kind === k ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-slate-200 text-slate-600'].join(' ')}
              >
                {t(`floorPlan:zone.${k.toLowerCase()}`)}
              </button>
            ))}
          </div>
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label={t('floorPlan:zone.width')}>
            <input type="number" className={inputCls} value={canvasWidth} min={200} max={10000} onChange={(e) => setCanvasWidth(Number(e.target.value))} />
          </Field>
          <Field label={t('floorPlan:zone.height')}>
            <input type="number" className={inputCls} value={canvasHeight} min={200} max={10000} onChange={(e) => setCanvasHeight(Number(e.target.value))} />
          </Field>
          <Field label={t('floorPlan:zone.grid')}>
            <input type="number" className={inputCls} value={gridSize} min={2} max={200} onChange={(e) => setGridSize(Number(e.target.value))} />
          </Field>
        </div>
        <Field label={t('floorPlan:zone.background')}>
          <input className={inputCls} value={backgroundImageUrl} onChange={(e) => setBg(e.target.value)} placeholder="https://…" />
        </Field>
        {backgroundImageUrl.trim() && (
          <Field label={t('floorPlan:zone.opacity', { value: Math.round(backgroundOpacity * 100) })}>
            <input type="range" min={0} max={1} step={0.05} value={backgroundOpacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-full" />
          </Field>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <button type="button" onClick={onDelete} className="text-sm text-red-600 flex items-center gap-1.5 hover:underline">
            <Trash2 className="w-4 h-4" /> {t('floorPlan:zone.delete')}
          </button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{t('common:cancel', 'Cancel')}</Button>
            <Button variant="primary" onClick={submit} isLoading={saving} disabled={!name.trim()}>{t('common:save', 'Save')}</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

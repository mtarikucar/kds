import { useTranslation } from 'react-i18next';
import {
  Undo2, Redo2, Save, Grid3x3, Circle, Square, RectangleHorizontal,
  Minus, DoorOpen, Wine, CookingPot, Sprout, Shapes, Type,
} from 'lucide-react';
import { FloorElementType, TableShape } from '../../../types';
import { ELEMENT_PALETTE } from '../constants';

const ELEMENT_ICON: Record<string, typeof Minus> = {
  Minus, DoorOpen, Wine, CookingPot, Sprout, Shapes, Type, Square,
};

interface Props {
  dirty: boolean;
  saving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  showGrid: boolean;
  onAddTable: (shape: TableShape) => void;
  onAddElement: (type: FloorElementType) => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleGrid: () => void;
  onSave: () => void;
}

const TbBtn = ({ onClick, disabled, title, children, active }: any) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={[
      'h-9 px-2.5 rounded-lg border text-sm flex items-center gap-1.5 transition-colors',
      active ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50',
      disabled ? 'opacity-40 cursor-not-allowed' : '',
    ].join(' ')}
  >
    {children}
  </button>
);

export default function EditorToolbar({
  dirty, saving, canUndo, canRedo, showGrid,
  onAddTable, onAddElement, onUndo, onRedo, onToggleGrid, onSave,
}: Props) {
  const { t } = useTranslation(['floorPlan', 'common']);

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-white border-b border-slate-200">
      {/* Tables */}
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wide mr-1">{t('floorPlan:addTable')}</span>
      <TbBtn onClick={() => onAddTable(TableShape.ROUND)} title={t('floorPlan:shapes.round')}>
        <Circle className="w-4 h-4" />
      </TbBtn>
      <TbBtn onClick={() => onAddTable(TableShape.SQUARE)} title={t('floorPlan:shapes.square')}>
        <Square className="w-4 h-4" />
      </TbBtn>
      <TbBtn onClick={() => onAddTable(TableShape.RECT)} title={t('floorPlan:shapes.rect')}>
        <RectangleHorizontal className="w-4 h-4" />
      </TbBtn>

      <div className="w-px h-6 bg-slate-200 mx-1" />

      {/* Elements */}
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wide mr-1">{t('floorPlan:addElement')}</span>
      {ELEMENT_PALETTE.map((item) => {
        const Icon = ELEMENT_ICON[item.icon] ?? Shapes;
        return (
          <TbBtn key={item.type} onClick={() => onAddElement(item.type)} title={t(item.labelKey)}>
            <Icon className="w-4 h-4" />
          </TbBtn>
        );
      })}

      <div className="flex-1" />

      {/* History + grid + save */}
      <TbBtn onClick={onUndo} disabled={!canUndo} title={t('floorPlan:undo')}>
        <Undo2 className="w-4 h-4" />
      </TbBtn>
      <TbBtn onClick={onRedo} disabled={!canRedo} title={t('floorPlan:redo')}>
        <Redo2 className="w-4 h-4" />
      </TbBtn>
      <TbBtn onClick={onToggleGrid} active={showGrid} title={t('floorPlan:toggleGrid')}>
        <Grid3x3 className="w-4 h-4" />
      </TbBtn>
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving}
        className={[
          'h-9 px-4 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors',
          dirty && !saving ? 'bg-primary-600 text-white hover:bg-primary-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed',
        ].join(' ')}
      >
        <Save className="w-4 h-4" />
        {saving ? t('floorPlan:saving') : t('common:app.save')}
        {dirty && !saving && <span className="w-2 h-2 rounded-full bg-white/90" />}
      </button>
    </div>
  );
}

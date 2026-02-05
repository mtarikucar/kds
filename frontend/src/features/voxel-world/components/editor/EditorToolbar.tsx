import { useTranslation } from 'react-i18next'
import {
  MousePointer2,
  Move,
  RotateCcw,
  Trash2,
  Undo,
  Redo,
  Save,
  Grid3X3,
  Table,
  TrendingUp,
} from 'lucide-react'
import { useVoxelStore } from '../../store/voxelStore'
import type { EditorTool } from '../../types/voxel'
import { cn } from '@/lib/utils'

interface EditorToolbarProps {
  onSave?: () => void
  onUndo?: () => void
  onRedo?: () => void
  canUndo?: boolean
  canRedo?: boolean
  isSaving?: boolean
}

const TOOLS: { tool: EditorTool; icon: typeof MousePointer2; labelKey: string; group?: 'primary' | 'action' }[] = [
  { tool: 'floor', icon: Grid3X3, labelKey: 'voxel.tools.floor', group: 'primary' },
  { tool: 'table', icon: Table, labelKey: 'voxel.tools.table', group: 'primary' },
  { tool: 'stair', icon: TrendingUp, labelKey: 'voxel.tools.stair', group: 'primary' },
  { tool: 'select', icon: MousePointer2, labelKey: 'voxel.tools.select', group: 'primary' },
  { tool: 'move', icon: Move, labelKey: 'voxel.tools.move', group: 'primary' },
  { tool: 'rotate', icon: RotateCcw, labelKey: 'voxel.tools.rotate', group: 'action' },
  { tool: 'delete', icon: Trash2, labelKey: 'voxel.tools.delete', group: 'action' },
]

export function EditorToolbar({
  onSave,
  onUndo,
  onRedo,
  canUndo = false,
  canRedo = false,
  isSaving = false,
}: EditorToolbarProps) {
  const { t } = useTranslation()
  const editorTool = useVoxelStore((state) => state.editorTool)
  const setEditorTool = useVoxelStore((state) => state.setEditorTool)
  const selectedObjectId = useVoxelStore((state) => state.selectedObjectId)
  const rotateObject = useVoxelStore((state) => state.rotateObject)
  const removeObject = useVoxelStore((state) => state.removeObject)

  const handleToolClick = (tool: EditorTool) => {
    if (tool === 'rotate' && selectedObjectId) {
      rotateObject(selectedObjectId)
    } else if (tool === 'delete' && selectedObjectId) {
      removeObject(selectedObjectId)
    } else {
      setEditorTool(tool)
    }
  }

  const primaryTools = TOOLS.filter((t) => t.group === 'primary')
  const actionTools = TOOLS.filter((t) => t.group === 'action')

  const getToolTitle = (tool: EditorTool, labelKey: string): string => {
    const label = t(labelKey)
    if (tool === 'floor') {
      return `${label} (Shift+drag to paint)`
    }
    return label
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Primary tools (floor, table, select, move) */}
      <div className="flex flex-col gap-1 rounded-lg bg-gray-800 p-2">
        {primaryTools.map(({ tool, icon: Icon, labelKey }) => {
          const isActive = editorTool === tool

          return (
            <button
              key={tool}
              onClick={() => handleToolClick(tool)}
              className={cn(
                'flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors',
                isActive
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:bg-gray-700 hover:text-white',
                tool === 'floor' && isActive && 'bg-blue-600'
              )}
              title={getToolTitle(tool, labelKey)}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{t(labelKey)}</span>
            </button>
          )
        })}
      </div>

      {/* Action tools (rotate, delete) */}
      <div className="flex flex-col gap-1 rounded-lg bg-gray-800 p-2">
        {actionTools.map(({ tool, icon: Icon, labelKey }) => {
          const needsSelection = !selectedObjectId

          return (
            <button
              key={tool}
              onClick={() => handleToolClick(tool)}
              disabled={needsSelection}
              className={cn(
                'flex items-center gap-2 rounded px-3 py-1.5 text-sm transition-colors',
                needsSelection
                  ? 'cursor-not-allowed text-gray-600'
                  : 'text-gray-400 hover:bg-gray-700 hover:text-white',
                tool === 'delete' && selectedObjectId && 'hover:bg-red-500/20 hover:text-red-400'
              )}
              title={t(labelKey)}
            >
              <Icon className="h-4 w-4" />
              <span className="hidden sm:inline">{t(labelKey)}</span>
            </button>
          )
        })}
      </div>

      {/* History controls */}
      <div className="flex gap-1 rounded-lg bg-gray-800 p-2">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className={cn(
            'rounded p-2 transition-colors',
            canUndo
              ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
              : 'cursor-not-allowed text-gray-600'
          )}
          title={t('voxel.tools.undo')}
        >
          <Undo className="h-4 w-4" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className={cn(
            'rounded p-2 transition-colors',
            canRedo
              ? 'text-gray-400 hover:bg-gray-700 hover:text-white'
              : 'cursor-not-allowed text-gray-600'
          )}
          title={t('voxel.tools.redo')}
        >
          <Redo className="h-4 w-4" />
        </button>
      </div>

      {/* Save button */}
      {onSave && (
        <button
          onClick={onSave}
          disabled={isSaving}
          className={cn(
            'flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            isSaving
              ? 'cursor-not-allowed bg-gray-700 text-gray-400'
              : 'bg-green-600 text-white hover:bg-green-500'
          )}
        >
          <Save className="h-4 w-4" />
          <span>{isSaving ? t('voxel.saving') : t('voxel.save')}</span>
        </button>
      )}
    </div>
  )
}

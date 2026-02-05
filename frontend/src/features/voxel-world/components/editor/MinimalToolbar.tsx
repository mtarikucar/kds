import { MousePointer, Plus, Trash2, Undo2, Redo2, RotateCw, Grid3X3, Magnet } from 'lucide-react'
import { useVoxelStore } from '../../store/voxelStore'
import { useHistory } from '../../hooks/useHistory'
import type { EditorTool } from '../../types/voxel'
import { cn } from '@/lib/utils'

interface ToolButtonProps {
  icon: React.ReactNode
  label: string
  shortcut?: string
  isActive?: boolean
  disabled?: boolean
  onClick: () => void
}

function ToolButton({ icon, label, shortcut, isActive, disabled, onClick }: ToolButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group relative flex h-10 w-10 items-center justify-center rounded-lg transition-all',
        isActive
          ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
          : disabled
            ? 'cursor-not-allowed text-gray-600'
            : 'bg-gray-800/80 text-gray-300 hover:bg-gray-700 hover:text-white'
      )}
      title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
    >
      {icon}
      {/* Tooltip */}
      <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
        {label}
        {shortcut && <span className="ml-1 text-gray-400">({shortcut})</span>}
      </div>
    </button>
  )
}

function Divider() {
  return <div className="mx-1 h-6 w-px bg-gray-700" />
}

export function MinimalToolbar() {
  const editorTool = useVoxelStore((state) => state.editorTool)
  const setEditorTool = useVoxelStore((state) => state.setEditorTool)
  const snapConfig = useVoxelStore((state) => state.snapConfig)
  const toggleSnap = useVoxelStore((state) => state.toggleSnap)
  const { undo, redo, canUndo, canRedo } = useHistory()

  const tools: { id: EditorTool; icon: React.ReactNode; label: string; shortcut: string }[] = [
    { id: 'select', icon: <MousePointer className="h-5 w-5" />, label: 'Select', shortcut: 'V' },
    { id: 'move', icon: <Grid3X3 className="h-5 w-5" />, label: 'Move', shortcut: 'M' },
    { id: 'rotate', icon: <RotateCw className="h-5 w-5" />, label: 'Rotate', shortcut: 'R' },
    { id: 'delete', icon: <Trash2 className="h-5 w-5" />, label: 'Delete', shortcut: 'Del' },
  ]

  return (
    <div className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-gray-900/90 p-1.5 shadow-2xl backdrop-blur-md">
      {/* Main Tools */}
      {tools.map((tool) => (
        <ToolButton
          key={tool.id}
          icon={tool.icon}
          label={tool.label}
          shortcut={tool.shortcut}
          isActive={editorTool === tool.id}
          onClick={() => setEditorTool(tool.id)}
        />
      ))}

      <Divider />

      {/* Add Object */}
      <ToolButton
        icon={<Plus className="h-5 w-5" />}
        label="Add Table"
        shortcut="T"
        onClick={() => {
          // This will open the object library or add mode
          setEditorTool('select')
        }}
      />

      <Divider />

      {/* Snap Toggle */}
      <ToolButton
        icon={<Magnet className="h-5 w-5" />}
        label="Snap to Grid"
        shortcut="G"
        isActive={snapConfig.enabled}
        onClick={toggleSnap}
      />

      <Divider />

      {/* Undo/Redo */}
      <ToolButton
        icon={<Undo2 className="h-5 w-5" />}
        label="Undo"
        shortcut="Ctrl+Z"
        disabled={!canUndo}
        onClick={undo}
      />
      <ToolButton
        icon={<Redo2 className="h-5 w-5" />}
        label="Redo"
        shortcut="Ctrl+Shift+Z"
        disabled={!canRedo}
        onClick={redo}
      />
    </div>
  )
}

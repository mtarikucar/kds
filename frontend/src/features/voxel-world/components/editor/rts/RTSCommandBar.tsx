import { useState, useCallback } from 'react'
import {
  MousePointer2,
  Grid3X3,
  TrendingUp,
  RotateCcw,
  Trash2,
  Undo2,
  Redo2,
  Magnet,
  Package,
  Settings,
  Move,
} from 'lucide-react'
import { useVoxelStore, selectSelectedObject } from '../../../store/voxelStore'
import { useEditorHotkeys } from '../../../hooks/useEditorHotkeys'
import type { EditorTool } from '../../../types/voxel'
import { cn } from '@/lib/utils'
import type { Table as TableType } from '@/types'
import { StatusBar } from './StatusBar'
import { RTSObjectLibrary } from './RTSObjectLibrary'
import { RTSSettingsPanel } from './RTSSettingsPanel'

interface RTSCommandBarProps {
  isSaving?: boolean
  tables?: TableType[]
}

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
        'group relative flex h-9 w-9 items-center justify-center rounded-md transition-all',
        isActive
          ? 'bg-primary text-white shadow-md shadow-primary/20'
          : disabled
            ? 'cursor-not-allowed text-slate-300'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      )}
      title={`${label}${shortcut ? ` (${shortcut})` : ''}`}
    >
      {icon}
      <div className="pointer-events-none absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 z-50">
        {label}
        {shortcut && <span className="ml-1 text-slate-400">({shortcut})</span>}
      </div>
    </button>
  )
}

function Divider() {
  return <div className="mx-1.5 h-8 w-px bg-slate-200" />
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-0.5 block text-center text-[9px] font-medium uppercase tracking-wider text-slate-400">
      {children}
    </span>
  )
}

export function RTSCommandBar({ isSaving = false, tables = [] }: RTSCommandBarProps) {
  const [showLibrary, setShowLibrary] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const editorTool = useVoxelStore((state) => state.editorTool)
  const setEditorTool = useVoxelStore((state) => state.setEditorTool)
  const selectedObjectId = useVoxelStore((state) => state.selectedObjectId)
  const selectedObject = useVoxelStore(selectSelectedObject)
  const rotateObject = useVoxelStore((state) => state.rotateObject)
  const removeObject = useVoxelStore((state) => state.removeObject)
  const canUndo = useVoxelStore((state) => state.canUndo)
  const canRedo = useVoxelStore((state) => state.canRedo)
  const undo = useVoxelStore((state) => state.undo)
  const redo = useVoxelStore((state) => state.redo)
  const snapConfig = useVoxelStore((state) => state.snapConfig)
  const toggleSnap = useVoxelStore((state) => state.toggleSnap)
  const layout = useVoxelStore((state) => state.layout)

  const handleRotate = useCallback(() => {
    if (selectedObjectId) {
      rotateObject(selectedObjectId)
    }
  }, [selectedObjectId, rotateObject])

  const handleDelete = useCallback(() => {
    if (selectedObjectId) {
      removeObject(selectedObjectId)
    }
  }, [selectedObjectId, removeObject])

  const toggleLibrary = useCallback(() => {
    setShowLibrary((prev) => !prev)
    setShowSettings(false)
  }, [])

  const toggleSettings = useCallback(() => {
    setShowSettings((prev) => !prev)
    setShowLibrary(false)
  }, [])

  // RTS-style keyboard shortcuts (V, F, B, G, S, M)
  useEditorHotkeys({ onToggleLibrary: toggleLibrary })

  // Tools available — no 'table' tool since tables come from the database only
  const toolButtons: { id: EditorTool; icon: React.ReactNode; label: string; shortcut: string }[] = [
    { id: 'select', icon: <MousePointer2 className="h-4 w-4" />, label: 'Select', shortcut: 'V' },
    { id: 'move', icon: <Move className="h-4 w-4" />, label: 'Move', shortcut: 'M' },
    { id: 'floor', icon: <Grid3X3 className="h-4 w-4" />, label: 'Floor', shortcut: 'F' },
    { id: 'stair', icon: <TrendingUp className="h-4 w-4" />, label: 'Stair', shortcut: 'S' },
  ]

  return (
    <>
      {/* Object Library Overlay */}
      {showLibrary && (
        <RTSObjectLibrary onClose={() => setShowLibrary(false)} />
      )}

      {/* Settings Panel */}
      {showSettings && (
        <RTSSettingsPanel onClose={() => setShowSettings(false)} />
      )}

      {/* Command Bar */}
      <div className="absolute bottom-6 left-1/2 z-30 -translate-x-1/2">
        <div className="flex items-end gap-1 rounded-xl bg-white/95 p-2 shadow-xl backdrop-blur-md border border-slate-200">
          {/* Tools Section */}
          <div className="flex flex-col items-center">
            <SectionLabel>Tools</SectionLabel>
            <div className="flex items-center gap-0.5">
              {toolButtons.map((tool) => (
                <ToolButton
                  key={tool.id}
                  icon={tool.icon}
                  label={tool.label}
                  shortcut={tool.shortcut}
                  isActive={editorTool === tool.id}
                  onClick={() => setEditorTool(tool.id)}
                />
              ))}
            </div>
          </div>

          <Divider />

          {/* Objects Section */}
          <div className="flex flex-col items-center">
            <SectionLabel>Objects</SectionLabel>
            <div className="flex items-center gap-0.5">
              <ToolButton
                icon={<Package className="h-4 w-4" />}
                label="Object Library"
                shortcut="B"
                isActive={showLibrary}
                onClick={toggleLibrary}
              />
            </div>
          </div>

          <Divider />

          {/* Actions Section */}
          <div className="flex flex-col items-center">
            <SectionLabel>Actions</SectionLabel>
            <div className="flex items-center gap-0.5">
              <ToolButton
                icon={<RotateCcw className="h-4 w-4" />}
                label="Rotate"
                shortcut="R"
                disabled={!selectedObjectId}
                onClick={handleRotate}
              />
              <ToolButton
                icon={<Trash2 className="h-4 w-4" />}
                label="Delete"
                shortcut="Del"
                disabled={!selectedObjectId}
                onClick={handleDelete}
              />
              <ToolButton
                icon={<Undo2 className="h-4 w-4" />}
                label="Undo"
                shortcut="Ctrl+Z"
                disabled={!canUndo}
                onClick={undo}
              />
              <ToolButton
                icon={<Redo2 className="h-4 w-4" />}
                label="Redo"
                shortcut="Ctrl+Y"
                disabled={!canRedo}
                onClick={redo}
              />
            </div>
          </div>

          <Divider />

          {/* Settings Section */}
          <div className="flex flex-col items-center">
            <SectionLabel>Settings</SectionLabel>
            <div className="flex items-center gap-0.5">
              <ToolButton
                icon={<Magnet className="h-4 w-4" />}
                label="Snap to Grid"
                shortcut="G"
                isActive={snapConfig.enabled}
                onClick={toggleSnap}
              />
              <ToolButton
                icon={<Settings className="h-4 w-4" />}
                label="Settings"
                isActive={showSettings}
                onClick={toggleSettings}
              />
            </div>
          </div>
        </div>

        {/* Status Bar */}
        <StatusBar
          isSaving={isSaving}
          objectCount={layout?.objects?.length ?? 0}
          snapEnabled={snapConfig.enabled}
          selectedObject={selectedObject}
        />
      </div>
    </>
  )
}

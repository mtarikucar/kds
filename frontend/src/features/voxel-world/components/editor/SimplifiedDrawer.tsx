import { useState } from 'react'
import {
  Settings,
  X,
  ChevronRight,
  ChevronLeft,
  LayoutGrid,
  Wand2,
  RotateCcw,
  Save,
  Sparkles,
  Palette,
  Armchair,
  Lamp,
  TreePine,
} from 'lucide-react'
import { useVoxelStore } from '../../store/voxelStore'
import { ObjectLibrary } from './ObjectLibrary'
import { TablePropertiesPanel } from './TablePropertiesPanel'
import { TABLE_STYLE_PRESETS, type TableStylePreset } from '../../utils/procedural'
import type { Table } from '@/types'
import { cn } from '@/lib/utils'

interface SimplifiedDrawerProps {
  isSaving?: boolean
  tables?: Table[]
  onGenerateChairs?: () => void
  onGenerateDecor?: () => void
  onApplyStyle?: (preset: TableStylePreset) => void
}

export function SimplifiedDrawer({
  isSaving = false,
  tables = [],
  onGenerateChairs,
  onGenerateDecor,
  onApplyStyle,
}: SimplifiedDrawerProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [selectedStyle, setSelectedStyle] = useState<TableStylePreset>('casual')

  const layout = useVoxelStore((state) => state.layout)
  const loadSampleLayout = useVoxelStore((state) => state.loadSampleLayout)
  const autoArrangeObjects = useVoxelStore((state) => state.autoArrangeObjects)
  const resetCamera = useVoxelStore((state) => state.resetCamera)
  const snapConfig = useVoxelStore((state) => state.snapConfig)
  const setSnapConfig = useVoxelStore((state) => state.setSnapConfig)

  const hasObjects = (layout?.objects?.length ?? 0) > 0
  const hasTables = layout?.objects?.some((obj) => obj.type === 'table') ?? false

  const stylePresets: { id: TableStylePreset; label: string; description: string }[] = [
    { id: 'casual', label: 'Casual', description: 'Light wood, modern style' },
    { id: 'formal', label: 'Formal', description: 'Dark wood, classic legs' },
    { id: 'modern', label: 'Modern', description: 'Metal, round tops' },
    { id: 'bistro', label: 'Bistro', description: 'Dark wood, pedestal' },
  ]

  return (
    <div className="absolute right-0 top-0 z-20 flex h-full">
      {/* Toggle Tab */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="mt-4 flex h-10 items-center rounded-l-lg bg-gray-800 px-1.5 text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
      >
        {isOpen ? (
          <ChevronRight className="h-4 w-4" />
        ) : (
          <ChevronLeft className="h-4 w-4" />
        )}
      </button>

      {/* Drawer Panel */}
      <div
        className={cn(
          'flex h-full w-72 flex-col bg-gray-900/95 backdrop-blur-sm transition-all duration-300',
          isOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'
        )}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Settings className="h-4 w-4" />
            Restaurant Editor
          </h2>
          <div className="flex items-center gap-1">
            {isSaving && (
              <div className="flex items-center gap-1 text-amber-400">
                <Save className="h-3.5 w-3.5 animate-pulse" />
              </div>
            )}
            <button
              onClick={() => setIsOpen(false)}
              className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-1 border-b border-gray-700 p-2">
          <button
            onClick={loadSampleLayout}
            className="flex flex-1 items-center justify-center gap-1.5 rounded bg-indigo-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
            title="Load sample layout"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>Sample</span>
          </button>
          <button
            onClick={autoArrangeObjects}
            disabled={!hasObjects}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium',
              hasObjects
                ? 'bg-violet-600 text-white hover:bg-violet-500'
                : 'cursor-not-allowed bg-gray-700 text-gray-500'
            )}
            title="Auto-arrange objects"
          >
            <Wand2 className="h-3.5 w-3.5" />
            <span>Arrange</span>
          </button>
          <button
            onClick={resetCamera}
            className="flex items-center justify-center rounded bg-gray-700 px-2 py-1.5 text-gray-300 hover:bg-gray-600"
            title="Reset camera"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Style Presets */}
          <div className="border-b border-gray-700 p-3">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-gray-400">
              <Palette className="h-3.5 w-3.5" />
              Table Style
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              {stylePresets.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => {
                    setSelectedStyle(preset.id)
                    onApplyStyle?.(preset.id)
                  }}
                  className={cn(
                    'rounded-lg px-2.5 py-2 text-left transition-all',
                    selectedStyle === preset.id
                      ? 'bg-blue-500/20 ring-1 ring-blue-500'
                      : 'bg-gray-800 hover:bg-gray-700'
                  )}
                >
                  <div className="text-xs font-medium text-white">{preset.label}</div>
                  <div className="text-[10px] text-gray-400">{preset.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Procedural Generation */}
          <div className="border-b border-gray-700 p-3">
            <h3 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-gray-400">
              <Sparkles className="h-3.5 w-3.5" />
              Auto-Generate
            </h3>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={onGenerateChairs}
                disabled={!hasTables}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all',
                  hasTables
                    ? 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30'
                    : 'cursor-not-allowed bg-gray-800 text-gray-500'
                )}
              >
                <Armchair className="h-4 w-4" />
                <span>Generate Chairs</span>
              </button>
              <button
                onClick={onGenerateDecor}
                disabled={!hasObjects}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-all',
                  hasObjects
                    ? 'bg-amber-600/20 text-amber-400 hover:bg-amber-600/30'
                    : 'cursor-not-allowed bg-gray-800 text-gray-500'
                )}
              >
                <div className="flex gap-1">
                  <Lamp className="h-4 w-4" />
                  <TreePine className="h-4 w-4" />
                </div>
                <span>Generate Decor</span>
              </button>
            </div>
          </div>

          {/* Snap Settings */}
          <div className="border-b border-gray-700 p-3">
            <h3 className="mb-2 text-xs font-medium uppercase text-gray-400">Snap Settings</h3>
            <div className="flex flex-col gap-2">
              <label className="flex items-center justify-between">
                <span className="text-sm text-gray-300">Enable Snap</span>
                <input
                  type="checkbox"
                  checked={snapConfig.enabled}
                  onChange={(e) => setSnapConfig({ enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                />
              </label>
              <label className="flex items-center justify-between">
                <span className="text-sm text-gray-300">Show Guides</span>
                <input
                  type="checkbox"
                  checked={snapConfig.showGuides}
                  onChange={(e) => setSnapConfig({ showGuides: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-blue-500"
                />
              </label>
              <div>
                <label className="mb-1 block text-sm text-gray-300">Grid Size</label>
                <input
                  type="range"
                  min="0.25"
                  max="1"
                  step="0.25"
                  value={snapConfig.gridSize}
                  onChange={(e) => setSnapConfig({ gridSize: parseFloat(e.target.value) })}
                  className="w-full"
                />
                <div className="text-xs text-gray-400">{snapConfig.gridSize} units</div>
              </div>
            </div>
          </div>

          {/* Selected Object Properties */}
          <div className="p-3">
            <TablePropertiesPanel />
          </div>

          {/* Object Library */}
          <div className="p-3">
            <ObjectLibrary />
          </div>
        </div>

        {/* Footer - Hint */}
        <div className="border-t border-gray-700 p-2 text-center">
          <p className="text-xs text-gray-500">
            Drag handles to resize • R to rotate • Delete to remove
          </p>
        </div>
      </div>
    </div>
  )
}

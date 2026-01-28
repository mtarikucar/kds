import { useState } from 'react'
import { Settings, X, ChevronRight, ChevronLeft, LayoutGrid, Wand2, RotateCcw, Save } from 'lucide-react'
import { EditorToolbar } from './EditorToolbar'
import { DimensionsEditor } from './DimensionsEditor'
import { ObjectLibrary } from './ObjectLibrary'
import { TableListPanel } from './TableListPanel'
import { TablePropertiesPanel } from './TablePropertiesPanel'
import { useVoxelStore } from '../../store/voxelStore'
import type { Table } from '@/types'
import { cn } from '@/lib/utils'

interface EditorDrawerProps {
  isSaving?: boolean
  tables?: Table[]
}

export function EditorDrawer({ isSaving = false, tables = [] }: EditorDrawerProps) {
  const [isOpen, setIsOpen] = useState(true)

  const layout = useVoxelStore((state) => state.layout)
  const loadSampleLayout = useVoxelStore((state) => state.loadSampleLayout)
  const autoArrangeObjects = useVoxelStore((state) => state.autoArrangeObjects)
  const resetCamera = useVoxelStore((state) => state.resetCamera)

  const hasObjects = (layout?.objects?.length ?? 0) > 0

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
          'flex h-full w-64 flex-col bg-gray-900/95 backdrop-blur-sm transition-all duration-300',
          isOpen ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-full opacity-0'
        )}
      >
        {/* Drawer Header */}
        <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Settings className="h-4 w-4" />
            Layout Ayarlari
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
            title="Ornek layout yukle"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>Ornek</span>
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
            title="Objeleri otomatik duzenle"
          >
            <Wand2 className="h-3.5 w-3.5" />
            <span>Duzenle</span>
          </button>
          <button
            onClick={resetCamera}
            className="flex items-center justify-center rounded bg-gray-700 px-2 py-1.5 text-gray-300 hover:bg-gray-600"
            title="Kamerayi sifirla"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-2">
          <div className="flex flex-col gap-2">
            {/* Editor Tools */}
            <EditorToolbar />

            {/* Table List Panel */}
            {tables.length > 0 && <TableListPanel tables={tables} />}

            {/* Selected Table Properties */}
            <TablePropertiesPanel />

            {/* Dimensions */}
            <DimensionsEditor />

            {/* Object Library */}
            <ObjectLibrary />
          </div>
        </div>
      </div>
    </div>
  )
}

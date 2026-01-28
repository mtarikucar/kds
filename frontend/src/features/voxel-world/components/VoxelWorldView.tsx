import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Edit3, RotateCcw, Layers, Map, Save, DoorOpen } from 'lucide-react'
import { VoxelCanvas } from './VoxelCanvas'
import { VoxelWorld } from './VoxelWorld'
import { EditorToolbar } from './editor/EditorToolbar'
import { ObjectLibrary } from './editor/ObjectLibrary'
import { Map2DView } from './map-2d'
import { ExteriorScene } from '../scenes/ExteriorScene'
import { InteriorScene } from '../scenes/InteriorScene'
import { PostprocessingEffects } from './effects/PostprocessingEffects'
import { useVoxelStore } from '../store/voxelStore'
import { useVoxelWorld } from '../hooks/useVoxelWorld'
import { useTablePositionSync } from '../hooks/useTablePositionSync'
import type { Table } from '@/types'
import { cn } from '@/lib/utils'

type ViewMode = '3d' | '2d'

interface VoxelWorldViewProps {
  tables: Table[]
  tenantId?: string
  onTableClick?: (tableId: string) => void
}

export function VoxelWorldView({ tables, tenantId, onTableClick }: VoxelWorldViewProps) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('3d')

  const isEditorMode = useVoxelStore((state) => state.isEditorMode)
  const toggleEditorMode = useVoxelStore((state) => state.toggleEditorMode)
  const resetCamera = useVoxelStore((state) => state.resetCamera)
  const storyPhase = useVoxelStore((state) => state.storyPhase)
  const setStoryPhase = useVoxelStore((state) => state.setStoryPhase)
  const resetDialogue = useVoxelStore((state) => state.resetDialogue)

  const handleEnterBuilding = useCallback(() => {
    setStoryPhase('interior')
  }, [setStoryPhase])

  const handleExitBuilding = useCallback(() => {
    resetDialogue()
    setStoryPhase('exterior')
  }, [setStoryPhase, resetDialogue])

  const { unplacedTables, autoPlaceTables } = useVoxelWorld({
    tables,
    tenantId,
  })

  // Sync table positions to backend when in editor mode
  const { isPending: isSaving } = useTablePositionSync({ enabled: isEditorMode })

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 100)
    return () => clearTimeout(timer)
  }, [])

  const handleAutoPlace = () => {
    autoPlaceTables()
  }

  if (isLoading) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-lg border border-gray-700 bg-gray-900">
        <div className="flex flex-col items-center gap-3">
          <Box className="h-12 w-12 animate-pulse text-primary" />
          <span className="text-sm text-gray-400">Loading 3D Restaurant View...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-[600px] overflow-hidden rounded-lg border border-gray-700 bg-gray-900">
      {/* Exterior Scene */}
      {storyPhase === 'exterior' && (
        <>
          {/* Hint text for exterior */}
          <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-gray-800/90 px-4 py-2 text-center">
            <span className="text-sm text-gray-300">
              Mascot'a tiklayarak konusabilir, binaya tiklayarak iceri girebilirsin
            </span>
          </div>

          <VoxelCanvas>
            <ExteriorScene onEnterBuilding={handleEnterBuilding} />
            <PostprocessingEffects />
          </VoxelCanvas>
        </>
      )}

      {/* Interior Scene */}
      {storyPhase === 'interior' && (
        <>
          {/* Exit button */}
          <button
            onClick={handleExitBuilding}
            className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700"
          >
            <DoorOpen className="h-4 w-4" />
            Disari Cik
          </button>

          {/* Toolbar */}
          <div className="absolute left-4 top-16 z-10 flex flex-col gap-2">
            {/* View mode toggle */}
            <div className="flex rounded-lg bg-gray-800 p-1">
              <button
                onClick={() => setViewMode('3d')}
                className={cn(
                  'flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                  viewMode === '3d'
                    ? 'bg-primary text-white'
                    : 'text-gray-400 hover:text-white'
                )}
              >
                <Box className="h-4 w-4" />
                3D
              </button>
              <button
                onClick={() => setViewMode('2d')}
                className={cn(
                  'flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                  viewMode === '2d'
                    ? 'bg-primary text-white'
                    : 'text-gray-400 hover:text-white'
                )}
              >
                <Map className="h-4 w-4" />
                2D
              </button>
            </div>

            {/* Editor mode toggle (only in 3D view) */}
            {viewMode === '3d' && (
              <button
                onClick={toggleEditorMode}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isEditorMode
                    ? 'bg-primary text-white'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                )}
              >
                <Edit3 className="h-4 w-4" />
                {isEditorMode ? 'Exit Editor' : 'Edit Layout'}
              </button>
            )}

            {/* Editor tools (only in 3D view and editor mode) */}
            {viewMode === '3d' && isEditorMode && (
              <>
                <EditorToolbar />
                <ObjectLibrary />
              </>
            )}
          </div>

          {/* Right side controls (only in 3D view) */}
          {viewMode === '3d' && (
            <div className="absolute right-4 top-4 z-10 flex flex-col gap-2">
              {/* Saving indicator */}
              {isEditorMode && isSaving && (
                <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/90 px-3 py-2 text-sm text-white">
                  <Save className="h-4 w-4 animate-pulse" />
                  <span>Saving...</span>
                </div>
              )}

              {/* Reset camera */}
              <button
                onClick={resetCamera}
                className="flex items-center gap-2 rounded-lg bg-gray-800 px-3 py-2 text-sm text-gray-300 hover:bg-gray-700"
                title="Reset camera"
              >
                <RotateCcw className="h-4 w-4" />
              </button>

              {/* Auto place unplaced tables */}
              {unplacedTables.length > 0 && (
                <button
                  onClick={handleAutoPlace}
                  className="flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500"
                >
                  <Layers className="h-4 w-4" />
                  <span>Place {unplacedTables.length} Tables</span>
                </button>
              )}
            </div>
          )}

          {/* Status legend (only in 3D view) */}
          {viewMode === '3d' && (
            <div className="absolute bottom-4 left-4 z-10 flex gap-3 rounded-lg bg-gray-800/90 px-4 py-2">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-full bg-green-500" />
                <span className="text-xs text-gray-300">Available</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-full bg-red-500" />
                <span className="text-xs text-gray-300">Occupied</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-3 rounded-full bg-amber-500" />
                <span className="text-xs text-gray-300">Reserved</span>
              </div>
            </div>
          )}

          {/* Help text (only in 3D view) */}
          {viewMode === '3d' && (
            <div className="absolute bottom-4 right-4 z-10 text-xs text-gray-500">
              Scroll to zoom • Shift+drag to pan
            </div>
          )}

          {/* 3D Canvas */}
          {viewMode === '3d' && (
            <VoxelCanvas>
              <InteriorScene />
              <PostprocessingEffects />
            </VoxelCanvas>
          )}

          {/* 2D Map View */}
          {viewMode === '2d' && (
            <div className="h-full">
              <Map2DView />
            </div>
          )}
        </>
      )}
    </div>
  )
}

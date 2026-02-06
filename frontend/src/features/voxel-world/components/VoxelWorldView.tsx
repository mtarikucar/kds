import { useEffect, useState, useCallback } from 'react'
import { Box, Edit3, Layers, Map, DoorOpen, Smartphone } from 'lucide-react'
import { VoxelCanvas } from './VoxelCanvas'
import { InteriorScene } from '../scenes/InteriorScene'
import { ExteriorScene } from '../scenes/ExteriorScene'
import { PostprocessingEffects } from './effects/PostprocessingEffects'
import { Map2DView } from './map-2d'
import { RTSCommandBar } from './editor/rts/RTSCommandBar'
import { SelectionInfoPanel } from './editor/rts/SelectionInfoPanel'
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

const MOBILE_BREAKPOINT = 768

export function VoxelWorldView({ tables, tenantId, onTableClick }: VoxelWorldViewProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('3d')
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const isEditorMode = useVoxelStore((state) => state.isEditorMode)
  const toggleEditorMode = useVoxelStore((state) => state.toggleEditorMode)
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

  const { isPending: isSaving } = useTablePositionSync({ enabled: isEditorMode })

  useEffect(() => {
    const timer = setTimeout(() => setIsLoading(false), 100)
    return () => clearTimeout(timer)
  }, [])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-gray-700 bg-gray-900">
        <div className="flex flex-col items-center gap-3">
          <Box className="h-12 w-12 animate-pulse text-primary" />
          <span className="text-sm text-gray-400">Loading 3D Restaurant View...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full overflow-hidden rounded-lg border border-gray-700 bg-gray-900">
      {/* Exterior Scene */}
      {storyPhase === 'exterior' && (
        <>
          <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-lg bg-gray-800/90 px-4 py-2 text-center">
            <span className="text-sm text-gray-300">
              Mascot'a tiklayarak konusabilir, binaya tiklayarak iceri girebilirsin
            </span>
          </div>

          <VoxelCanvas>
            <ExteriorScene onEnterBuilding={handleEnterBuilding} />
            <PostprocessingEffects isExterior />
          </VoxelCanvas>
        </>
      )}

      {/* Interior Scene */}
      {storyPhase === 'interior' && (
        <>
          {/* Exit building button - floating top-left */}
          <button
            onClick={handleExitBuilding}
            className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-lg bg-gray-800/90 px-3 py-2 text-sm font-medium text-gray-300 backdrop-blur-sm transition-colors hover:bg-gray-700"
          >
            <DoorOpen className="h-4 w-4" />
            Disari Cik
          </button>

          {/* Top-left floating controls */}
          <div className="absolute left-4 top-14 z-10 flex flex-col gap-2">
            {/* View mode toggle */}
            <div className="flex rounded-lg bg-gray-800/90 p-1 backdrop-blur-sm">
              <button
                onClick={() => setViewMode('3d')}
                className={cn(
                  'flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                  viewMode === '3d'
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-400 hover:text-white'
                )}
              >
                <Box className="h-4 w-4" />
                3D
              </button>
              <button
                onClick={() => setViewMode('2d')}
                className={cn(
                  'flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                  viewMode === '2d'
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-400 hover:text-white'
                )}
              >
                <Map className="h-4 w-4" />
                2D
              </button>
            </div>

            {/* Editor mode toggle */}
            {viewMode === '3d' && !isMobile && (
              <button
                onClick={toggleEditorMode}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium backdrop-blur-sm transition-colors',
                  isEditorMode
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-800/90 text-gray-300 hover:bg-gray-700'
                )}
              >
                <Edit3 className="h-4 w-4" />
                {isEditorMode ? 'Exit Editor' : 'Edit Layout'}
              </button>
            )}
          </div>

          {/* RTS Command Bar (editor mode only, desktop only) */}
          {viewMode === '3d' && isEditorMode && !isMobile && (
            <>
              <RTSCommandBar isSaving={isSaving} tables={tables} />
              <SelectionInfoPanel />
            </>
          )}

          {/* Auto place unplaced tables — available in both editor and non-editor mode */}
          {viewMode === '3d' && !isMobile && unplacedTables.length > 0 && (
            <div className="absolute right-4 top-4 z-10">
              <button
                onClick={autoPlaceTables}
                className="flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-500"
              >
                <Layers className="h-4 w-4" />
                <span>Place {unplacedTables.length} Tables</span>
              </button>
            </div>
          )}

          {/* Non-editor mode overlays */}
          {viewMode === '3d' && !isEditorMode && !isMobile && (
            <>
              {/* Status legend */}
              <div className="absolute bottom-4 left-4 z-10 flex gap-3 rounded-lg bg-gray-800/90 px-4 py-2 backdrop-blur-sm">
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

              {/* Help text */}
              <div className="absolute bottom-4 right-4 z-10 text-xs text-gray-500">
                Scroll to zoom | Shift+drag to rotate | Middle-drag to pan
              </div>
            </>
          )}

          {/* 3D Canvas */}
          {viewMode === '3d' && !isMobile && (
            <VoxelCanvas>
              <InteriorScene />
              <PostprocessingEffects />
            </VoxelCanvas>
          )}

          {/* Mobile warning */}
          {viewMode === '3d' && isMobile && (
            <div className="flex h-full flex-col items-center justify-center gap-4 bg-gray-900 p-6 text-center">
              <Smartphone className="h-16 w-16 text-gray-500" />
              <h3 className="text-lg font-semibold text-gray-300">
                3D Duzenleyici Mobilde Kullanilamiyor
              </h3>
              <p className="max-w-sm text-sm text-gray-500">
                3D masa duzenleme ozelligi sadece tablet ve bilgisayarda kullanilabilir.
                Lutfen daha buyuk bir ekrandan erisin veya 2D harita gorunumunu kullanin.
              </p>
              <button
                onClick={() => setViewMode('2d')}
                className="mt-2 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90"
              >
                <Map className="h-4 w-4" />
                2D Haritaya Gec
              </button>
            </div>
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

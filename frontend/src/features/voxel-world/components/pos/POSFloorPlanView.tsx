import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Map, Box, Maximize2, Minimize2 } from 'lucide-react'
import { POSMap2DView } from './POSMap2DView'
import { VoxelCanvas } from '../VoxelCanvas'
import { VoxelWorld } from '../VoxelWorld'
import { MiniMap2D } from '../mini-maps/MiniMap2D'
import { MiniMap3D } from '../mini-maps/MiniMap3D'
import { useVoxelStore } from '../../store/voxelStore'
import type { Map2DConfig, Map2DObject } from '../../types/map2d'
import { DEFAULT_MAP2D_CONFIG } from '../../types/map2d'
import type { Table } from '@/types'
import { cn } from '@/lib/utils'
import { useGetPosSettings } from '@/features/pos/posApi'

interface TableNotifications {
  orders: number
  waiter: number
  bill: number
}

interface POSFloorPlanViewProps {
  tables: Table[]
  onTableSelect: (table: Table) => void
  selectedTableId: string | null
  notifications: Map<string, TableNotifications>
}

type ViewMode = '2d' | '3d'

export function POSFloorPlanView({
  tables,
  onTableSelect,
  selectedTableId,
  notifications,
}: POSFloorPlanViewProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 })
  const [viewMode, setViewMode] = useState<ViewMode>('2d')
  const [showMiniMap, setShowMiniMap] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [hasInitializedViewMode, setHasInitializedViewMode] = useState(false)

  // Get POS settings for default map view
  const { data: posSettings } = useGetPosSettings()

  // Initialize view mode from settings
  useEffect(() => {
    if (posSettings?.defaultMapView && !hasInitializedViewMode) {
      const validModes: ViewMode[] = ['2d', '3d']
      const mode = validModes.includes(posSettings.defaultMapView as ViewMode)
        ? (posSettings.defaultMapView as ViewMode)
        : '2d'
      setViewMode(mode)
      setHasInitializedViewMode(true)
    }
  }, [posSettings?.defaultMapView, hasInitializedViewMode])

  // Voxel store state
  const layout = useVoxelStore((state) => state.layout)

  // Create config from layout
  const config = useMemo<Map2DConfig>(
    () => ({
      ...DEFAULT_MAP2D_CONFIG,
      width: layout?.dimensions.width ?? DEFAULT_MAP2D_CONFIG.width,
      height: layout?.dimensions.depth ?? DEFAULT_MAP2D_CONFIG.height,
    }),
    [layout?.dimensions]
  )

  // Convert tables directly to 2D map objects
  // This bypasses the layout.objects which may be empty
  const map2dObjects = useMemo((): Map2DObject[] => {
    return tables.map((table, index) => ({
      id: table.id,
      type: 'table' as const,
      x: (index % 4) * 4 + 2, // Grid layout with offset
      z: Math.floor(index / 4) * 4 + 2,
      width: 2,
      depth: 2,
      rotation: 0,
      label: String(table.number),
      color: '#8B4513',
    }))
  }, [tables])

  // Create table status map - now directly keyed by table.id since map2dObjects uses table.id
  const tableStatuses = useMemo(() => {
    const entries: Array<[string, 'available' | 'occupied' | 'reserved']> = tables.map(
      (table) => [table.id, table.status as 'available' | 'occupied' | 'reserved']
    )
    return new globalThis.Map(entries)
  }, [tables])

  // Create notification map - notifications are already keyed by tableId which matches map2dObjects
  const tableNotifications = useMemo(() => {
    const entries: Array<[string, TableNotifications]> = []
    notifications.forEach((notification, tableId) => {
      entries.push([tableId, notification])
    })
    return new globalThis.Map(entries)
  }, [notifications])

  // Handle table selection from map - mapObjectId is now table.id
  const handleMapTableSelect = useCallback(
    (mapObjectId: string) => {
      const table = tables.find((t) => t.id === mapObjectId)
      if (table) {
        onTableSelect(table)
      }
    },
    [tables, onTableSelect]
  )

  // Selected map object ID is now the same as table ID
  const selectedMapObjectId = selectedTableId

  // Track container size
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateSize = () => {
      const rect = container.getBoundingClientRect()
      setContainerSize({ width: rect.width, height: rect.height })
    }

    updateSize()

    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(container)

    return () => resizeObserver.disconnect()
  }, [])

  // Handle fullscreen toggle
  const handleFullscreenToggle = useCallback(() => {
    setIsFullscreen((prev) => !prev)
  }, [])

  // Handle mini-map click to switch views
  const handleMiniMapClick = useCallback(() => {
    setViewMode((prev) => (prev === '2d' ? '3d' : '2d'))
  }, [])

  // Handle view mode toggle
  const handleViewModeToggle = useCallback((mode: ViewMode) => {
    setViewMode(mode)
  }, [])

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex flex-col bg-slate-900 rounded-xl overflow-hidden',
        isFullscreen ? 'fixed inset-4 z-50' : 'h-full'
      )}
    >
      {/* Header with view toggle */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800/80 backdrop-blur-sm border-b border-slate-700/50">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-white">
            {t('pos.floorPlan.title', 'Floor Plan')}
          </h3>
          <div className="flex items-center gap-1 ml-3">
            <span className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-xs text-slate-400">
              {t('pos.floorPlan.available', 'Available')}
            </span>
            <span className="h-2 w-2 rounded-full bg-red-500 ml-2" />
            <span className="text-xs text-slate-400">
              {t('pos.floorPlan.occupied', 'Occupied')}
            </span>
            <span className="h-2 w-2 rounded-full bg-amber-500 ml-2" />
            <span className="text-xs text-slate-400">
              {t('pos.floorPlan.reserved', 'Reserved')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View mode toggle */}
          <div className="flex items-center rounded-lg bg-slate-700/50 p-1">
            <button
              onClick={() => handleViewModeToggle('2d')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                viewMode === '2d'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-600/50'
              )}
            >
              <Map className="h-3.5 w-3.5" />
              <span>2D</span>
            </button>
            <button
              onClick={() => handleViewModeToggle('3d')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
                viewMode === '3d'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-600/50'
              )}
            >
              <Box className="h-3.5 w-3.5" />
              <span>3D</span>
            </button>
          </div>

          {/* Fullscreen toggle */}
          <button
            onClick={handleFullscreenToggle}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors"
            title={isFullscreen ? t('pos.floorPlan.exitFullscreen', 'Exit Fullscreen') : t('pos.floorPlan.fullscreen', 'Fullscreen')}
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="flex-1 relative">
        {/* 2D View */}
        {viewMode === '2d' && (
          <POSMap2DView
            objects={map2dObjects}
            config={config}
            tableStatuses={tableStatuses}
            tableNotifications={tableNotifications}
            selectedTableId={selectedMapObjectId}
            onTableSelect={handleMapTableSelect}
            containerWidth={containerSize.width}
            containerHeight={containerSize.height - 56} // Subtract header height
          />
        )}

        {/* 3D View */}
        {viewMode === '3d' && (
          <VoxelCanvas>
            <VoxelWorld isometric />
          </VoxelCanvas>
        )}

        {/* Mini-map */}
        {showMiniMap && (
          <div
            className={cn(
              'absolute z-10 transition-all duration-300',
              viewMode === '2d'
                ? 'bottom-4 left-1/2 -translate-x-1/2' // 3D preview at bottom-center in 2D mode
                : 'bottom-4 right-4' // 2D overview at bottom-right in 3D mode
            )}
          >
            {viewMode === '2d' ? (
              <MiniMap3D
                layout={layout}
                onClick={handleMiniMapClick}
                width={200}
                height={150}
              />
            ) : (
              <MiniMap2D
                objects={map2dObjects}
                config={config}
                tableStatuses={tableStatuses}
                selectedTableId={selectedMapObjectId}
                onClick={handleMiniMapClick}
                width={200}
                height={150}
              />
            )}
          </div>
        )}

        {/* Mini-map toggle (for mobile) */}
        <button
          onClick={() => setShowMiniMap((prev) => !prev)}
          className="absolute bottom-4 left-4 z-10 p-2 rounded-lg bg-slate-800/80 backdrop-blur-sm text-slate-400 hover:text-white hover:bg-slate-700 transition-colors md:hidden"
        >
          {showMiniMap ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            viewMode === '2d' ? <Box className="h-4 w-4" /> : <Map className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Help text */}
      <div className="px-4 py-2 bg-slate-800/50 border-t border-slate-700/50">
        <p className="text-xs text-slate-500 text-center">
          {viewMode === '2d'
            ? t('pos.floorPlan.helpText2d', 'Click a table to select • Scroll to zoom • Shift+drag to pan')
            : t('pos.floorPlan.helpText3d', 'Click a table to select • Drag to rotate view • Scroll to zoom')}
        </p>
      </div>
    </div>
  )
}

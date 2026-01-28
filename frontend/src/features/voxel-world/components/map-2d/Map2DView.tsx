import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Map, HelpCircle } from 'lucide-react'
import { Map2DCanvas } from './Map2DCanvas'
import { Map2DToolbar } from './Map2DToolbar'
import { Map2DObjectProperties } from './Map2DObjectProperties'
import { useVoxelStore } from '../../store/voxelStore'
import { voxelObjectsToMap2D, snapToGrid } from '../../utils/map2dAdapter'
import type { Map2DConfig, Map2DViewState, Map2DObject } from '../../types/map2d'
import { DEFAULT_MAP2D_CONFIG, DEFAULT_MAP2D_VIEW_STATE, MAP2D_COLORS } from '../../types/map2d'

export function Map2DView() {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 })

  // Voxel store state
  const layout = useVoxelStore((state) => state.layout)
  const selectedObjectId = useVoxelStore((state) => state.selectedObjectId)
  const hoveredObjectId = useVoxelStore((state) => state.hoveredObjectId)
  const selectObject = useVoxelStore((state) => state.selectObject)
  const hoverObject = useVoxelStore((state) => state.hoverObject)
  const moveObject = useVoxelStore((state) => state.moveObject)
  const setObjectRotation = useVoxelStore((state) => state.setObjectRotation)
  const setDragging = useVoxelStore((state) => state.setDragging)

  // Local state
  const [draggingObjectId, setDraggingObjectId] = useState<string | null>(null)
  const [config, setConfig] = useState<Map2DConfig>(() => ({
    ...DEFAULT_MAP2D_CONFIG,
    width: layout?.dimensions.width ?? DEFAULT_MAP2D_CONFIG.width,
    height: layout?.dimensions.depth ?? DEFAULT_MAP2D_CONFIG.height,
  }))
  const [viewState, setViewState] = useState<Map2DViewState>(DEFAULT_MAP2D_VIEW_STATE)

  // Convert voxel objects to 2D map objects
  const map2dObjects = useMemo((): Map2DObject[] => {
    if (!layout?.objects) return []
    return voxelObjectsToMap2D(layout.objects)
  }, [layout?.objects])

  // Get selected object in 2D format
  const selectedMap2DObject = useMemo(() => {
    if (!selectedObjectId) return null
    return map2dObjects.find((obj) => obj.id === selectedObjectId) ?? null
  }, [map2dObjects, selectedObjectId])

  // Get original Y position for the selected object
  const getOriginalY = useCallback(
    (id: string): number => {
      const voxelObj = layout?.objects.find((obj) => obj.id === id)
      return voxelObj?.position.y ?? 0
    },
    [layout?.objects]
  )

  // Update config when layout dimensions change
  useEffect(() => {
    if (layout?.dimensions) {
      setConfig((prev) => ({
        ...prev,
        width: layout.dimensions.width,
        height: layout.dimensions.depth,
      }))
    }
  }, [layout?.dimensions])

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

  // Handlers
  const handleConfigChange = useCallback((updates: Partial<Map2DConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }))
  }, [])

  const handleViewStateChange = useCallback((newViewState: Map2DViewState) => {
    setViewState(newViewState)
  }, [])

  const handleObjectDragStart = useCallback(
    (id: string) => {
      setDraggingObjectId(id)
      setDragging(true)
      selectObject(id)
    },
    [setDragging, selectObject]
  )

  const handleObjectDragMove = useCallback(
    (_id: string, _x: number, _z: number) => {
      // Optional: could update position in real-time for preview
    },
    []
  )

  const handleObjectDragEnd = useCallback(
    (id: string, x: number, z: number) => {
      setDraggingObjectId(null)
      setDragging(false)

      // Apply snap if enabled
      const finalPos = config.snapToGrid
        ? snapToGrid({ x, z }, config.gridSize)
        : { x, z }

      // Clamp to bounds
      const obj = map2dObjects.find((o) => o.id === id)
      if (obj) {
        const clampedX = Math.max(0, Math.min(config.width - obj.width, finalPos.x))
        const clampedZ = Math.max(0, Math.min(config.height - obj.depth, finalPos.z))
        const originalY = getOriginalY(id)

        moveObject(id, { x: clampedX, y: originalY, z: clampedZ })
      }
    },
    [config, map2dObjects, moveObject, setDragging, getOriginalY]
  )

  const handleObjectClick = useCallback(
    (id: string) => {
      selectObject(id)
    },
    [selectObject]
  )

  const handleObjectHover = useCallback(
    (id: string | null) => {
      hoverObject(id)
    },
    [hoverObject]
  )

  const handleCanvasClick = useCallback(() => {
    selectObject(null)
  }, [selectObject])

  const handlePositionChange = useCallback(
    (x: number, z: number) => {
      if (!selectedObjectId) return
      const originalY = getOriginalY(selectedObjectId)
      moveObject(selectedObjectId, { x, y: originalY, z })
    },
    [selectedObjectId, moveObject, getOriginalY]
  )

  const handleRotationChange = useCallback(
    (rotation: number) => {
      if (!selectedObjectId) return
      setObjectRotation(selectedObjectId, rotation)
    },
    [selectedObjectId, setObjectRotation]
  )

  const handleCloseProperties = useCallback(() => {
    selectObject(null)
  }, [selectObject])

  // Status legend items
  const legendItems = [
    { label: t('admin.table', 'Table'), color: MAP2D_COLORS.table },
    { label: t('voxel.library.title', 'Furniture'), color: MAP2D_COLORS.model },
  ]

  return (
    <div className="flex h-full flex-col bg-slate-900 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800/80 backdrop-blur-sm border-b border-slate-700/50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-white">
            <Map className="h-5 w-5 text-primary" />
            <h2 className="text-sm font-semibold">
              {t('admin.floorPlan', 'Floor Plan')} - 2D
            </h2>
          </div>

          {/* Status legend */}
          <div className="flex items-center gap-3 ml-4 pl-4 border-l border-slate-600/50">
            {legendItems.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5">
                <div
                  className="h-3 w-3 rounded"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-xs text-slate-400">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Map2DToolbar
            config={config}
            viewState={viewState}
            onConfigChange={handleConfigChange}
            onViewStateChange={handleViewStateChange}
          />
        </div>
      </div>

      {/* Main content area */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Canvas */}
        <div ref={containerRef} className="flex-1 bg-slate-900">
          <Map2DCanvas
            objects={map2dObjects}
            config={config}
            viewState={viewState}
            selectedObjectId={selectedObjectId}
            hoveredObjectId={hoveredObjectId}
            draggingObjectId={draggingObjectId}
            containerWidth={containerSize.width}
            containerHeight={containerSize.height}
            onViewStateChange={handleViewStateChange}
            onObjectDragStart={handleObjectDragStart}
            onObjectDragMove={handleObjectDragMove}
            onObjectDragEnd={handleObjectDragEnd}
            onObjectClick={handleObjectClick}
            onObjectHover={handleObjectHover}
            onCanvasClick={handleCanvasClick}
          />
        </div>

        {/* Properties panel */}
        {selectedMap2DObject && (
          <div className="absolute bottom-4 right-4 z-10 w-72">
            <Map2DObjectProperties
              object={selectedMap2DObject}
              worldBounds={{ width: config.width, height: config.height }}
              onPositionChange={handlePositionChange}
              onRotationChange={handleRotationChange}
              onClose={handleCloseProperties}
            />
          </div>
        )}

        {/* Help text overlay */}
        <div className="absolute bottom-4 left-4 z-10 flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/80 backdrop-blur-sm border border-slate-700/50">
          <HelpCircle className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs text-slate-400">
            {t('voxel.map2d.helpText', 'Scroll to zoom • Shift+drag to pan • Click to select')}
          </span>
        </div>
      </div>
    </div>
  )
}

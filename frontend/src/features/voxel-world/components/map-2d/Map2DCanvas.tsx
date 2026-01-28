import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { Stage, Layer, Rect, Line } from 'react-konva'
import type Konva from 'konva'
import type { Map2DObject as Map2DObjectType, Map2DConfig, Map2DViewState } from '../../types/map2d'
import { Map2DObject } from './Map2DObject'
import { LAYER_ORDER } from './renderers'

// Design tokens for improved 2D map
const MAP2D_DESIGN = {
  floor: '#1E293B',
  floorAccent: '#334155',
  gridMain: '#475569',
  gridMinor: '#3D4A5C',
  border: '#64748B',
  shadow: 'rgba(0, 0, 0, 0.5)',
}

interface Map2DCanvasProps {
  objects: Map2DObjectType[]
  config: Map2DConfig
  viewState: Map2DViewState
  selectedObjectId: string | null
  hoveredObjectId: string | null
  draggingObjectId: string | null
  containerWidth: number
  containerHeight: number
  tableStatuses?: Map<string, 'available' | 'occupied' | 'reserved'>
  onViewStateChange: (viewState: Map2DViewState) => void
  onObjectDragStart: (id: string) => void
  onObjectDragMove: (id: string, x: number, z: number) => void
  onObjectDragEnd: (id: string, x: number, z: number) => void
  onObjectClick: (id: string) => void
  onObjectHover: (id: string | null) => void
  onCanvasClick: () => void
}

export function Map2DCanvas({
  objects,
  config,
  viewState,
  selectedObjectId,
  hoveredObjectId,
  draggingObjectId,
  containerWidth,
  containerHeight,
  tableStatuses,
  onViewStateChange,
  onObjectDragStart,
  onObjectDragMove,
  onObjectDragEnd,
  onObjectClick,
  onObjectHover,
  onCanvasClick,
}: Map2DCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [lastPanPosition, setLastPanPosition] = useState({ x: 0, y: 0 })

  const { scale, offsetX, offsetY } = viewState
  const { width: worldWidth, height: worldHeight, gridSize, showGrid } = config

  // Calculate canvas dimensions based on world size
  const canvasWorldWidth = worldWidth * scale
  const canvasWorldHeight = worldHeight * scale

  // Sort objects by layer order (z-ordering) for proper rendering
  const sortedObjects = useMemo(() => {
    return [...objects].sort((a, b) => {
      const layerA = LAYER_ORDER[a.type] ?? 10
      const layerB = LAYER_ORDER[b.type] ?? 10
      return layerA - layerB
    })
  }, [objects])

  // Generate grid lines with improved styling
  const gridLines = useMemo(() => {
    const lines: { points: number[]; isMain: boolean }[] = []
    if (!showGrid) return lines

    // Vertical lines
    for (let x = 0; x <= worldWidth; x += gridSize) {
      const isMain = x % 4 === 0
      lines.push({
        points: [x * scale, 0, x * scale, canvasWorldHeight],
        isMain,
      })
    }
    // Horizontal lines
    for (let z = 0; z <= worldHeight; z += gridSize) {
      const isMain = z % 4 === 0
      lines.push({
        points: [0, z * scale, canvasWorldWidth, z * scale],
        isMain,
      })
    }
    return lines
  }, [showGrid, worldWidth, worldHeight, gridSize, scale, canvasWorldWidth, canvasWorldHeight])

  // Handle mouse wheel zoom
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault()

      const stage = stageRef.current
      if (!stage) return

      const oldScale = scale
      const pointer = stage.getPointerPosition()
      if (!pointer) return

      const scaleBy = 1.1
      const direction = e.evt.deltaY > 0 ? -1 : 1
      const newScale = direction > 0 ? oldScale * scaleBy : oldScale / scaleBy

      // Limit scale range
      const clampedScale = Math.max(5, Math.min(50, newScale))

      // Calculate new offset to zoom towards pointer
      const mousePointTo = {
        x: (pointer.x - offsetX) / oldScale,
        y: (pointer.y - offsetY) / oldScale,
      }

      const newOffsetX = pointer.x - mousePointTo.x * clampedScale
      const newOffsetY = pointer.y - mousePointTo.y * clampedScale

      onViewStateChange({
        scale: clampedScale,
        offsetX: newOffsetX,
        offsetY: newOffsetY,
      })
    },
    [scale, offsetX, offsetY, onViewStateChange]
  )

  // Handle pan start (middle mouse or shift+left click)
  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Middle mouse button or shift+left click for panning
      if (e.evt.button === 1 || (e.evt.button === 0 && e.evt.shiftKey)) {
        e.evt.preventDefault()
        setIsPanning(true)
        setLastPanPosition({ x: e.evt.clientX, y: e.evt.clientY })
      }
    },
    []
  )

  // Handle pan move
  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isPanning) return

      const dx = e.evt.clientX - lastPanPosition.x
      const dy = e.evt.clientY - lastPanPosition.y

      onViewStateChange({
        scale,
        offsetX: offsetX + dx,
        offsetY: offsetY + dy,
      })

      setLastPanPosition({ x: e.evt.clientX, y: e.evt.clientY })
    },
    [isPanning, lastPanPosition, scale, offsetX, offsetY, onViewStateChange]
  )

  // Handle pan end
  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  // Handle stage click (deselect)
  const handleStageClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Only deselect if clicking on stage background
      if (e.target === e.currentTarget) {
        onCanvasClick()
      }
    },
    [onCanvasClick]
  )

  // Handle object hover leave
  const handleMouseLeaveObject = useCallback(
    (id: string) => {
      if (hoveredObjectId === id) {
        onObjectHover(null)
      }
    },
    [hoveredObjectId, onObjectHover]
  )

  // Set up global mouse up listener for pan
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsPanning(false)
    }
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [])

  return (
    <Stage
      ref={stageRef}
      width={containerWidth}
      height={containerHeight}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onClick={handleStageClick}
      style={{ cursor: isPanning ? 'grabbing' : 'default' }}
    >
      {/* Grid layer */}
      <Layer x={offsetX} y={offsetY}>
        {/* Background shadow effect */}
        <Rect
          x={-4}
          y={-4}
          width={canvasWorldWidth + 8}
          height={canvasWorldHeight + 8}
          fill={MAP2D_DESIGN.floorAccent}
          cornerRadius={6}
          shadowColor="#000"
          shadowBlur={20}
          shadowOpacity={0.4}
          shadowOffset={{ x: 4, y: 4 }}
        />

        {/* Main floor */}
        <Rect
          x={0}
          y={0}
          width={canvasWorldWidth}
          height={canvasWorldHeight}
          fill={MAP2D_DESIGN.floor}
          cornerRadius={4}
          onClick={onCanvasClick}
        />

        {/* Grid lines with improved styling */}
        {gridLines.map((line, index) => (
          <Line
            key={index}
            points={line.points}
            stroke={line.isMain ? MAP2D_DESIGN.gridMain : MAP2D_DESIGN.gridMinor}
            strokeWidth={line.isMain ? 1 : 0.5}
            opacity={line.isMain ? 0.5 : 0.25}
            listening={false}
          />
        ))}

        {/* Room boundary with improved styling */}
        <Rect
          x={0}
          y={0}
          width={canvasWorldWidth}
          height={canvasWorldHeight}
          stroke={MAP2D_DESIGN.border}
          strokeWidth={2}
          cornerRadius={4}
          listening={false}
        />
      </Layer>

      {/* Objects layer (z-ordered) */}
      <Layer x={offsetX} y={offsetY}>
        {sortedObjects.map((object) => (
          <Map2DObject
            key={object.id}
            object={object}
            scale={scale}
            isSelected={selectedObjectId === object.id}
            isHovered={hoveredObjectId === object.id}
            isDragging={draggingObjectId === object.id}
            snapToGrid={config.snapToGrid}
            gridSize={config.gridSize}
            tableStatuses={tableStatuses}
            onDragStart={onObjectDragStart}
            onDragMove={onObjectDragMove}
            onDragEnd={onObjectDragEnd}
            onClick={onObjectClick}
            onMouseEnter={onObjectHover}
            onMouseLeave={handleMouseLeaveObject}
          />
        ))}
      </Layer>
    </Stage>
  )
}

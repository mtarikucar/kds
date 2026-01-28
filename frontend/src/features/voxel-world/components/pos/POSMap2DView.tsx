import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { Stage, Layer, Rect, Line, Group, Circle, Arc, Text } from 'react-konva'
import type Konva from 'konva'
import { POSMap2DTable } from './POSMap2DTable'
import type { Map2DConfig, Map2DViewState, Map2DObject } from '../../types/map2d'
import { LAYER_ORDER, MAP2D_COLORS_PRO } from '../map-2d/renderers'

// Design tokens for 2D map
const MAP2D_DESIGN = {
  floor: '#1E293B',
  floorAccent: '#334155',
  gridMain: '#475569',
  gridMinor: '#3D4A5C',
  border: '#64748B',
}

interface TableNotifications {
  orders: number
  waiter: number
  bill: number
}

interface POSMap2DViewProps {
  objects: Map2DObject[]
  config: Map2DConfig
  tableStatuses: Map<string, 'available' | 'occupied' | 'reserved'>
  tableNotifications: Map<string, TableNotifications>
  selectedTableId: string | null
  onTableSelect: (tableId: string) => void
  containerWidth: number
  containerHeight: number
}

// Non-interactive object renderers using Konva
function WallObject({
  object,
  scale,
}: {
  object: Map2DObject
  scale: number
}) {
  const isRotated90or270 = object.rotation === 90 || object.rotation === 270
  const w = (isRotated90or270 ? object.depth : object.width) * scale
  const h = (isRotated90or270 ? object.width : object.depth) * scale
  const x = object.x * scale
  const y = object.z * scale

  return (
    <Group x={x} y={y} listening={false}>
      {/* Shadow */}
      <Rect
        x={2}
        y={2}
        width={w}
        height={h}
        fill={MAP2D_COLORS_PRO.wallShadow}
        cornerRadius={1}
      />
      {/* Main wall */}
      <Rect
        x={0}
        y={0}
        width={w}
        height={h}
        fill={MAP2D_COLORS_PRO.wall}
        cornerRadius={1}
      />
      {/* Highlight */}
      <Line
        points={[0, h, 0, 0, w, 0]}
        stroke={MAP2D_COLORS_PRO.wallHighlight}
        strokeWidth={1}
        opacity={0.3}
      />
    </Group>
  )
}

function DoorObject({
  object,
  scale,
}: {
  object: Map2DObject
  scale: number
}) {
  const isRotated90or270 = object.rotation === 90 || object.rotation === 270
  const w = (isRotated90or270 ? object.depth : object.width) * scale
  const h = (isRotated90or270 ? object.width : object.depth) * scale
  const x = object.x * scale
  const y = object.z * scale
  const isHorizontal = w > h
  const frameWidth = 3

  return (
    <Group x={x} y={y} listening={false}>
      {/* Door frame sides */}
      <Rect
        x={0}
        y={0}
        width={isHorizontal ? frameWidth : w}
        height={isHorizontal ? h : frameWidth}
        fill={MAP2D_COLORS_PRO.doorFrame}
        cornerRadius={1}
      />
      <Rect
        x={isHorizontal ? w - frameWidth : 0}
        y={isHorizontal ? 0 : h - frameWidth}
        width={isHorizontal ? frameWidth : w}
        height={isHorizontal ? h : frameWidth}
        fill={MAP2D_COLORS_PRO.doorFrame}
        cornerRadius={1}
      />
      {/* Swing arc */}
      <Arc
        x={frameWidth}
        y={h / 2}
        innerRadius={(w - frameWidth * 2) * 0.8}
        outerRadius={(w - frameWidth * 2) * 0.85}
        angle={90}
        rotation={isHorizontal ? -45 : 45}
        fill={MAP2D_COLORS_PRO.doorSwing}
        stroke={MAP2D_COLORS_PRO.door}
        strokeWidth={1}
        dash={[4, 4]}
        opacity={0.7}
      />
    </Group>
  )
}

function WindowObject({
  object,
  scale,
}: {
  object: Map2DObject
  scale: number
}) {
  const isRotated90or270 = object.rotation === 90 || object.rotation === 270
  const w = (isRotated90or270 ? object.depth : object.width) * scale
  const h = (isRotated90or270 ? object.width : object.depth) * scale
  const x = object.x * scale
  const y = object.z * scale
  const frameWidth = 2

  return (
    <Group x={x} y={y} listening={false}>
      {/* Frame */}
      <Rect
        x={0}
        y={0}
        width={w}
        height={h}
        fill={MAP2D_COLORS_PRO.windowFrame}
        cornerRadius={1}
      />
      {/* Glass */}
      <Rect
        x={frameWidth}
        y={frameWidth}
        width={w - frameWidth * 2}
        height={h - frameWidth * 2}
        fill={MAP2D_COLORS_PRO.windowGlass}
        cornerRadius={1}
      />
      {/* Glass shine */}
      <Rect
        x={frameWidth + 2}
        y={frameWidth + 2}
        width={(w - frameWidth * 2) * 0.3}
        height={(h - frameWidth * 2) * 0.4}
        fill="rgba(255, 255, 255, 0.3)"
        cornerRadius={1}
      />
      {/* Center divider */}
      <Line
        points={w > h ? [w / 2, frameWidth, w / 2, h - frameWidth] : [frameWidth, h / 2, w - frameWidth, h / 2]}
        stroke={MAP2D_COLORS_PRO.windowFrame}
        strokeWidth={2}
      />
    </Group>
  )
}

function KitchenObject({
  object,
  scale,
}: {
  object: Map2DObject
  scale: number
}) {
  const isRotated90or270 = object.rotation === 90 || object.rotation === 270
  const w = (isRotated90or270 ? object.depth : object.width) * scale
  const h = (isRotated90or270 ? object.width : object.depth) * scale
  const x = object.x * scale
  const y = object.z * scale
  const burnerRadius = Math.min(w, h) * 0.1

  return (
    <Group x={x} y={y} listening={false}>
      {/* Shadow */}
      <Rect
        x={3}
        y={3}
        width={w}
        height={h}
        fill="rgba(0,0,0,0.25)"
        cornerRadius={3}
      />
      {/* Main surface */}
      <Rect
        x={0}
        y={0}
        width={w}
        height={h}
        fill={MAP2D_COLORS_PRO.kitchen}
        cornerRadius={3}
      />
      {/* Metallic shine */}
      <Rect
        x={4}
        y={4}
        width={w - 8}
        height={6}
        fill={MAP2D_COLORS_PRO.kitchenSurface}
        opacity={0.4}
        cornerRadius={2}
      />
      {/* Burners */}
      {[
        { cx: w * 0.3, cy: h * 0.3 },
        { cx: w * 0.7, cy: h * 0.3 },
        { cx: w * 0.3, cy: h * 0.7 },
        { cx: w * 0.7, cy: h * 0.7 },
      ].map((pos, i) => (
        <Group key={i}>
          <Circle x={pos.cx} y={pos.cy} radius={burnerRadius} fill={MAP2D_COLORS_PRO.kitchenEquipment} />
          <Circle x={pos.cx} y={pos.cy} radius={burnerRadius * 0.6} fill={MAP2D_COLORS_PRO.kitchen} />
          <Circle x={pos.cx} y={pos.cy} radius={burnerRadius * 0.25} fill={MAP2D_COLORS_PRO.kitchenEquipment} />
        </Group>
      ))}
    </Group>
  )
}

function BarObject({
  object,
  scale,
}: {
  object: Map2DObject
  scale: number
}) {
  const isRotated90or270 = object.rotation === 90 || object.rotation === 270
  const w = (isRotated90or270 ? object.depth : object.width) * scale
  const h = (isRotated90or270 ? object.width : object.depth) * scale
  const x = object.x * scale
  const y = object.z * scale
  const isHorizontal = w > h
  const cornerRadius = Math.min(w, h) * 0.2

  return (
    <Group x={x} y={y} listening={false}>
      {/* Shadow */}
      <Rect
        x={3}
        y={3}
        width={w}
        height={h}
        fill="rgba(0,0,0,0.3)"
        cornerRadius={isHorizontal ? [cornerRadius, cornerRadius, 4, 4] : [cornerRadius, 4, 4, cornerRadius]}
      />
      {/* Main counter */}
      <Rect
        x={0}
        y={0}
        width={w}
        height={h}
        fill={MAP2D_COLORS_PRO.bar}
        cornerRadius={isHorizontal ? [cornerRadius, cornerRadius, 4, 4] : [cornerRadius, 4, 4, cornerRadius]}
      />
      {/* Bar top */}
      <Rect
        x={4}
        y={4}
        width={w - 8}
        height={h - 8}
        fill={MAP2D_COLORS_PRO.barTop}
        cornerRadius={isHorizontal ? [cornerRadius - 4, cornerRadius - 4, 2, 2] : [cornerRadius - 4, 2, 2, cornerRadius - 4]}
      />
      {/* Footrest indicator */}
      <Line
        points={isHorizontal ? [8, h - 4, w - 8, h - 4] : [w - 4, 8, w - 4, h - 8]}
        stroke={MAP2D_COLORS_PRO.barFootrest}
        strokeWidth={3}
        lineCap="round"
        opacity={0.7}
      />
    </Group>
  )
}

function ChairObject({
  object,
  scale,
}: {
  object: Map2DObject
  scale: number
}) {
  const isRotated90or270 = object.rotation === 90 || object.rotation === 270
  const w = (isRotated90or270 ? object.depth : object.width) * scale
  const h = (isRotated90or270 ? object.width : object.depth) * scale
  const x = object.x * scale
  const y = object.z * scale

  return (
    <Group x={x} y={y} listening={false}>
      <Rect
        x={0}
        y={0}
        width={w}
        height={h}
        fill={MAP2D_COLORS_PRO.chairSeat}
        cornerRadius={2}
      />
      {/* Backrest */}
      <Rect
        x={0}
        y={0}
        width={w}
        height={h * 0.2}
        fill={MAP2D_COLORS_PRO.chair}
        cornerRadius={2}
      />
    </Group>
  )
}

function DecorObject({
  object,
  scale,
}: {
  object: Map2DObject
  scale: number
}) {
  const isRotated90or270 = object.rotation === 90 || object.rotation === 270
  const w = (isRotated90or270 ? object.depth : object.width) * scale
  const h = (isRotated90or270 ? object.width : object.depth) * scale
  const x = object.x * scale
  const y = object.z * scale
  const plantRadius = Math.min(w, h) * 0.4

  return (
    <Group x={x} y={y} listening={false}>
      {/* Plant foliage */}
      <Circle x={w / 2} y={h / 2} radius={plantRadius} fill={MAP2D_COLORS_PRO.plant} opacity={0.9} />
      <Circle x={w / 2 - plantRadius * 0.3} y={h / 2} radius={plantRadius * 0.7} fill={MAP2D_COLORS_PRO.plant} opacity={0.8} />
      <Circle x={w / 2 + plantRadius * 0.3} y={h / 2} radius={plantRadius * 0.7} fill={MAP2D_COLORS_PRO.plant} opacity={0.8} />
      {/* Pot */}
      <Rect
        x={w / 2 - Math.min(w, h) * 0.15}
        y={h - Math.min(w, h) * 0.2}
        width={Math.min(w, h) * 0.3}
        height={Math.min(w, h) * 0.15}
        fill={MAP2D_COLORS_PRO.plantPot}
        cornerRadius={[0, 0, 2, 2]}
      />
    </Group>
  )
}

function ModelObject({
  object,
  scale,
}: {
  object: Map2DObject
  scale: number
}) {
  const isRotated90or270 = object.rotation === 90 || object.rotation === 270
  const w = (isRotated90or270 ? object.depth : object.width) * scale
  const h = (isRotated90or270 ? object.width : object.depth) * scale
  const x = object.x * scale
  const y = object.z * scale
  const fontSize = Math.min(w, h) * 0.25

  return (
    <Group x={x} y={y} listening={false}>
      {/* Shadow */}
      <Rect
        x={3}
        y={3}
        width={w}
        height={h}
        fill="rgba(0,0,0,0.25)"
        cornerRadius={4}
      />
      {/* Main shape */}
      <Rect
        x={0}
        y={0}
        width={w}
        height={h}
        fill={MAP2D_COLORS_PRO.model}
        stroke={MAP2D_COLORS_PRO.modelOutline}
        strokeWidth={1.5}
        cornerRadius={4}
        dash={[4, 4]}
      />
      {/* Label */}
      {object.label && fontSize >= 6 && (
        <Text
          x={0}
          y={h - fontSize - 4}
          width={w}
          text={object.label}
          fontSize={fontSize}
          fill="#fff"
          align="center"
        />
      )}
    </Group>
  )
}

export function POSMap2DView({
  objects,
  config,
  tableStatuses,
  tableNotifications,
  selectedTableId,
  onTableSelect,
  containerWidth,
  containerHeight,
}: POSMap2DViewProps) {
  const stageRef = useRef<Konva.Stage>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [lastPanPosition, setLastPanPosition] = useState({ x: 0, y: 0 })
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null)
  const [viewState, setViewState] = useState<Map2DViewState>(() => {
    // Calculate initial scale to fit the floor plan nicely
    const padding = 40
    const scaleX = (containerWidth - padding * 2) / config.width
    const scaleY = (containerHeight - padding * 2) / config.height
    const scale = Math.min(scaleX, scaleY, 25) // Cap at 25 for reasonable zoom

    // Center the view
    const offsetX = (containerWidth - config.width * scale) / 2
    const offsetY = (containerHeight - config.height * scale) / 2

    return {
      scale,
      offsetX,
      offsetY,
    }
  })

  const { scale, offsetX, offsetY } = viewState
  const { width: worldWidth, height: worldHeight, gridSize, showGrid } = config

  // Calculate canvas dimensions based on world size
  const canvasWorldWidth = worldWidth * scale
  const canvasWorldHeight = worldHeight * scale

  // Recalculate view when container size changes
  useEffect(() => {
    const padding = 40
    const scaleX = (containerWidth - padding * 2) / config.width
    const scaleY = (containerHeight - padding * 2) / config.height
    const newScale = Math.min(scaleX, scaleY, 25)

    const newOffsetX = (containerWidth - config.width * newScale) / 2
    const newOffsetY = (containerHeight - config.height * newScale) / 2

    setViewState({
      scale: newScale,
      offsetX: newOffsetX,
      offsetY: newOffsetY,
    })
  }, [containerWidth, containerHeight, config.width, config.height])

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

  // Sort all objects by layer order for proper z-ordering
  const sortedObjects = useMemo(() => {
    return [...objects].sort((a, b) => {
      const layerA = LAYER_ORDER[a.type] ?? 10
      const layerB = LAYER_ORDER[b.type] ?? 10
      return layerA - layerB
    })
  }, [objects])

  // Separate tables from other objects (tables are interactive)
  const { tableObjects, nonTableObjects } = useMemo(() => {
    const tables: Map2DObject[] = []
    const others: Map2DObject[] = []

    sortedObjects.forEach((obj) => {
      if (obj.type === 'table') {
        tables.push(obj)
      } else {
        others.push(obj)
      }
    })

    return { tableObjects: tables, nonTableObjects: others }
  }, [sortedObjects])

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
      const clampedScale = Math.max(5, Math.min(40, newScale))

      // Calculate new offset to zoom towards pointer
      const mousePointTo = {
        x: (pointer.x - offsetX) / oldScale,
        y: (pointer.y - offsetY) / oldScale,
      }

      const newOffsetX = pointer.x - mousePointTo.x * clampedScale
      const newOffsetY = pointer.y - mousePointTo.y * clampedScale

      setViewState({
        scale: clampedScale,
        offsetX: newOffsetX,
        offsetY: newOffsetY,
      })
    },
    [scale, offsetX, offsetY]
  )

  // Handle pan start (middle mouse or shift+left click)
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button === 1 || (e.evt.button === 0 && e.evt.shiftKey)) {
      e.evt.preventDefault()
      setIsPanning(true)
      setLastPanPosition({ x: e.evt.clientX, y: e.evt.clientY })
    }
  }, [])

  // Handle pan move
  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!isPanning) return

      const dx = e.evt.clientX - lastPanPosition.x
      const dy = e.evt.clientY - lastPanPosition.y

      setViewState((prev) => ({
        ...prev,
        offsetX: prev.offsetX + dx,
        offsetY: prev.offsetY + dy,
      }))

      setLastPanPosition({ x: e.evt.clientX, y: e.evt.clientY })
    },
    [isPanning, lastPanPosition]
  )

  // Handle pan end
  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
  }, [])

  // Handle table click
  const handleTableClick = useCallback(
    (tableId: string) => {
      onTableSelect(tableId)
    },
    [onTableSelect]
  )

  // Set up global mouse up listener for pan
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      setIsPanning(false)
    }
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [])

  // Render non-table object based on type
  const renderNonTableObject = (obj: Map2DObject) => {
    switch (obj.type) {
      case 'wall':
        return <WallObject key={obj.id} object={obj} scale={scale} />
      case 'door':
        return <DoorObject key={obj.id} object={obj} scale={scale} />
      case 'window':
        return <WindowObject key={obj.id} object={obj} scale={scale} />
      case 'kitchen':
        return <KitchenObject key={obj.id} object={obj} scale={scale} />
      case 'bar':
        return <BarObject key={obj.id} object={obj} scale={scale} />
      case 'chair':
        return <ChairObject key={obj.id} object={obj} scale={scale} />
      case 'decor':
        return <DecorObject key={obj.id} object={obj} scale={scale} />
      case 'model':
        return <ModelObject key={obj.id} object={obj} scale={scale} />
      default:
        return null
    }
  }

  return (
    <Stage
      ref={stageRef}
      width={containerWidth}
      height={containerHeight}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{ cursor: isPanning ? 'grabbing' : 'default' }}
    >
      {/* Grid layer */}
      <Layer x={offsetX} y={offsetY}>
        {/* Background with gradient effect */}
        <Rect
          x={-2}
          y={-2}
          width={canvasWorldWidth + 4}
          height={canvasWorldHeight + 4}
          fill={MAP2D_DESIGN.floorAccent}
          cornerRadius={4}
          shadowColor="#000"
          shadowBlur={20}
          shadowOpacity={0.5}
        />
        <Rect
          x={0}
          y={0}
          width={canvasWorldWidth}
          height={canvasWorldHeight}
          fill={MAP2D_DESIGN.floor}
        />

        {/* Grid lines */}
        {gridLines.map((line, index) => (
          <Line
            key={index}
            points={line.points}
            stroke={line.isMain ? MAP2D_DESIGN.gridMain : MAP2D_DESIGN.gridMinor}
            strokeWidth={line.isMain ? 1 : 0.5}
            opacity={line.isMain ? 0.6 : 0.3}
            listening={false}
          />
        ))}

        {/* Room boundary */}
        <Rect
          x={0}
          y={0}
          width={canvasWorldWidth}
          height={canvasWorldHeight}
          stroke={MAP2D_DESIGN.border}
          strokeWidth={2}
          listening={false}
        />
      </Layer>

      {/* Non-table objects layer (z-ordered, non-interactive) */}
      <Layer x={offsetX} y={offsetY}>
        {nonTableObjects.map(renderNonTableObject)}
      </Layer>

      {/* Tables layer (interactive) */}
      <Layer x={offsetX} y={offsetY}>
        {tableObjects.map((object) => {
          const status = tableStatuses.get(object.id) ?? 'available'
          const notifications = tableNotifications.get(object.id)

          return (
            <POSMap2DTable
              key={object.id}
              object={object}
              scale={scale}
              isSelected={selectedTableId === object.id}
              isHovered={hoveredObjectId === object.id}
              status={status}
              notifications={notifications}
              onClick={handleTableClick}
              onMouseEnter={setHoveredObjectId}
              onMouseLeave={() => setHoveredObjectId(null)}
            />
          )
        })}
      </Layer>
    </Stage>
  )
}

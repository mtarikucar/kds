import { useRef, useEffect } from 'react'
import { Group } from 'react-konva'
import type Konva from 'konva'
import type { Map2DObject as Map2DObjectType } from '../../types/map2d'
import {
  WallRenderer,
  DoorRenderer,
  WindowRenderer,
  TableRenderer,
  ChairRenderer,
  KitchenRenderer,
  BarRenderer,
  DecorRenderer,
  ModelRenderer,
  FloorRenderer,
} from './renderers'

interface Map2DObjectProps {
  object: Map2DObjectType
  scale: number
  isSelected: boolean
  isHovered: boolean
  isDragging: boolean
  snapToGrid: boolean
  gridSize: number
  tableStatuses?: Map<string, 'available' | 'occupied' | 'reserved'>
  onDragStart: (id: string) => void
  onDragMove: (id: string, x: number, z: number) => void
  onDragEnd: (id: string, x: number, z: number) => void
  onClick: (id: string) => void
  onMouseEnter: (id: string) => void
  onMouseLeave: (id: string) => void
}

export function Map2DObject({
  object,
  scale,
  isSelected,
  isHovered,
  isDragging,
  snapToGrid: shouldSnapToGrid,
  gridSize,
  tableStatuses,
  onDragStart,
  onDragMove,
  onDragEnd,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: Map2DObjectProps) {
  const groupRef = useRef<Konva.Group>(null)

  // Handle dimension swapping for 90/270 degree rotations
  const isRotated90or270 = object.rotation === 90 || object.rotation === 270
  const effectiveWidth = isRotated90or270 ? object.depth : object.width
  const effectiveHeight = isRotated90or270 ? object.width : object.depth

  // Convert world coordinates to canvas coordinates
  const canvasX = object.x * scale
  const canvasY = object.z * scale
  const canvasWidth = effectiveWidth * scale
  const canvasHeight = effectiveHeight * scale

  // Snap helper
  const snapPosition = (pos: number): number => {
    if (!shouldSnapToGrid) return pos / scale
    return Math.round(pos / scale / gridSize) * gridSize
  }

  const handleDragStart = () => {
    onDragStart(object.id)
  }

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target
    const x = snapPosition(node.x())
    const z = snapPosition(node.y())
    onDragMove(object.id, x, z)
  }

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target
    const x = snapPosition(node.x())
    const z = snapPosition(node.y())

    // Snap position visually
    if (shouldSnapToGrid) {
      node.x(x * scale)
      node.y(z * scale)
    }

    onDragEnd(object.id, x, z)
  }

  const handleClick = () => {
    onClick(object.id)
  }

  const handleMouseEnter = () => {
    onMouseEnter(object.id)
  }

  const handleMouseLeave = () => {
    onMouseLeave(object.id)
  }

  // Reset position when object position changes externally
  useEffect(() => {
    if (groupRef.current && !isDragging) {
      groupRef.current.x(canvasX)
      groupRef.current.y(canvasY)
    }
  }, [canvasX, canvasY, isDragging])

  // Common props for all renderers
  const rendererProps = {
    object,
    scale,
    isSelected,
    isHovered,
    isDragging,
    canvasWidth,
    canvasHeight,
  }

  // Factory function to render the appropriate component based on object type
  const renderObject = () => {
    switch (object.type) {
      case 'wall':
        return <WallRenderer {...rendererProps} />

      case 'door':
        return <DoorRenderer {...rendererProps} />

      case 'window':
        return <WindowRenderer {...rendererProps} />

      case 'table': {
        const status = tableStatuses?.get(object.id) ?? 'available'
        return <TableRenderer {...rendererProps} status={status} />
      }

      case 'chair':
        return <ChairRenderer {...rendererProps} />

      case 'kitchen':
        return <KitchenRenderer {...rendererProps} />

      case 'bar':
        return <BarRenderer {...rendererProps} />

      case 'decor':
        return <DecorRenderer {...rendererProps} />

      case 'model':
        return <ModelRenderer {...rendererProps} />

      case 'floor':
        return <FloorRenderer {...rendererProps} />

      default:
        // Fallback for unknown types - use a simple rectangle
        return <FallbackRenderer {...rendererProps} />
    }
  }

  return (
    <Group
      ref={groupRef}
      x={canvasX}
      y={canvasY}
      draggable
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onClick={handleClick}
      onTap={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {renderObject()}
    </Group>
  )
}

// Fallback renderer for unknown object types
import { Rect, Text } from 'react-konva'
import { VOXEL_COLORS } from '../../types/voxel'

interface FallbackRendererProps {
  object: Map2DObjectType
  scale: number
  isSelected: boolean
  isHovered: boolean
  isDragging: boolean
  canvasWidth: number
  canvasHeight: number
}

function FallbackRenderer({
  object,
  isSelected,
  isHovered,
  isDragging,
  canvasWidth,
  canvasHeight,
}: FallbackRendererProps) {
  const getStroke = () => {
    if (isSelected) return VOXEL_COLORS.selected
    if (isHovered) return VOXEL_COLORS.hovered
    return '#00000033'
  }

  const getStrokeWidth = () => {
    if (isSelected) return 3
    if (isHovered) return 2
    return 1
  }

  const fontSize = Math.min(canvasWidth, canvasHeight) * 0.4
  const showLabel = object.label && fontSize >= 8

  return (
    <Group>
      <Rect
        x={0}
        y={0}
        width={canvasWidth}
        height={canvasHeight}
        fill={object.color ?? '#6B7280'}
        stroke={getStroke()}
        strokeWidth={getStrokeWidth()}
        cornerRadius={4}
        shadowColor="#000"
        shadowBlur={isDragging ? 10 : isSelected ? 5 : 0}
        shadowOpacity={isDragging ? 0.3 : isSelected ? 0.2 : 0}
        shadowOffset={{ x: 2, y: 2 }}
      />

      {showLabel && (
        <Text
          x={0}
          y={0}
          width={canvasWidth}
          height={canvasHeight}
          text={object.label}
          fontSize={fontSize}
          fontStyle="bold"
          fill="#fff"
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      )}
    </Group>
  )
}

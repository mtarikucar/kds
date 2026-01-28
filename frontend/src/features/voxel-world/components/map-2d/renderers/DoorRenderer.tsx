import { Rect, Arc, Line, Group } from 'react-konva'
import type { RendererProps } from './types'
import { MAP2D_COLORS_PRO } from './types'

interface DoorRendererProps extends RendererProps {
  canvasWidth: number
  canvasHeight: number
}

export function DoorRenderer({
  object,
  scale,
  isSelected,
  isHovered,
  canvasWidth,
  canvasHeight,
}: DoorRendererProps) {
  // Door dimensions
  const frameWidth = 3
  const isHorizontal = canvasWidth > canvasHeight
  const doorWidth = isHorizontal ? canvasWidth : canvasHeight
  const doorDepth = isHorizontal ? canvasHeight : canvasWidth

  const getStroke = () => {
    if (isSelected) return MAP2D_COLORS_PRO.selected
    if (isHovered) return MAP2D_COLORS_PRO.hovered
    return MAP2D_COLORS_PRO.doorFrame
  }

  // Calculate swing arc based on rotation
  const rotation = object.rotation || 0
  const swingRadius = doorWidth * 0.9
  let arcAngle = 0
  let arcStartX = 0
  let arcStartY = 0

  // Default swing direction based on rotation
  if (isHorizontal) {
    arcStartX = frameWidth
    arcStartY = doorDepth / 2
    arcAngle = rotation === 180 ? 180 : 0
  } else {
    arcStartX = doorDepth / 2
    arcStartY = frameWidth
    arcAngle = rotation === 90 ? 90 : 270
  }

  return (
    <Group>
      {/* Door frame (sides) */}
      <Rect
        x={0}
        y={0}
        width={isHorizontal ? frameWidth : canvasWidth}
        height={isHorizontal ? canvasHeight : frameWidth}
        fill={MAP2D_COLORS_PRO.doorFrame}
        cornerRadius={1}
      />
      <Rect
        x={isHorizontal ? canvasWidth - frameWidth : 0}
        y={isHorizontal ? 0 : canvasHeight - frameWidth}
        width={isHorizontal ? frameWidth : canvasWidth}
        height={isHorizontal ? canvasHeight : frameWidth}
        fill={MAP2D_COLORS_PRO.doorFrame}
        cornerRadius={1}
      />

      {/* Door opening (floor visible) */}
      <Rect
        x={isHorizontal ? frameWidth : 0}
        y={isHorizontal ? 0 : frameWidth}
        width={isHorizontal ? canvasWidth - frameWidth * 2 : canvasWidth}
        height={isHorizontal ? canvasHeight : canvasHeight - frameWidth * 2}
        fill="transparent"
      />

      {/* Swing arc indicator */}
      <Arc
        x={arcStartX}
        y={arcStartY}
        innerRadius={swingRadius - 2}
        outerRadius={swingRadius}
        angle={90}
        rotation={arcAngle}
        fill={MAP2D_COLORS_PRO.doorSwing}
        stroke={MAP2D_COLORS_PRO.door}
        strokeWidth={1}
        dash={[4, 4]}
        opacity={0.7}
        listening={false}
      />

      {/* Door leaf line */}
      <Line
        points={
          isHorizontal
            ? [arcStartX, arcStartY, arcStartX + swingRadius * 0.7, arcStartY - swingRadius * 0.7]
            : [arcStartX, arcStartY, arcStartX + swingRadius * 0.7, arcStartY + swingRadius * 0.7]
        }
        stroke={MAP2D_COLORS_PRO.door}
        strokeWidth={3}
        lineCap="round"
        listening={false}
      />

      {/* Selection/hover outline */}
      {(isSelected || isHovered) && (
        <Rect
          x={0}
          y={0}
          width={canvasWidth}
          height={canvasHeight}
          fill="transparent"
          stroke={getStroke()}
          strokeWidth={2}
          dash={[4, 4]}
          cornerRadius={2}
        />
      )}
    </Group>
  )
}

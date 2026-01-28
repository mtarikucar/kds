import { Rect, Circle, Ellipse, Group } from 'react-konva'
import type { RendererProps } from './types'
import { MAP2D_COLORS_PRO } from './types'

interface DecorRendererProps extends RendererProps {
  canvasWidth: number
  canvasHeight: number
}

export function DecorRenderer({
  object,
  scale,
  isSelected,
  isHovered,
  isDragging,
  canvasWidth,
  canvasHeight,
}: DecorRendererProps) {
  const getStroke = () => {
    if (isSelected) return MAP2D_COLORS_PRO.selected
    if (isHovered) return MAP2D_COLORS_PRO.hovered
    return 'transparent'
  }

  const centerX = canvasWidth / 2
  const centerY = canvasHeight / 2
  const plantRadius = Math.min(canvasWidth, canvasHeight) * 0.4
  const potRadius = Math.min(canvasWidth, canvasHeight) * 0.25
  const potHeight = Math.min(canvasWidth, canvasHeight) * 0.2

  return (
    <Group>
      {/* Shadow */}
      <Ellipse
        x={centerX + 2}
        y={canvasHeight - potHeight / 2 + 3}
        radiusX={potRadius * 1.2}
        radiusY={potRadius * 0.5}
        fill="rgba(0,0,0,0.2)"
        listening={false}
      />

      {/* Plant foliage (multiple circles for organic look) */}
      <Circle
        x={centerX}
        y={centerY - plantRadius * 0.3}
        radius={plantRadius}
        fill={MAP2D_COLORS_PRO.plant}
        opacity={0.9}
        listening={false}
      />
      <Circle
        x={centerX - plantRadius * 0.4}
        y={centerY - plantRadius * 0.1}
        radius={plantRadius * 0.7}
        fill={MAP2D_COLORS_PRO.plant}
        opacity={0.8}
        listening={false}
      />
      <Circle
        x={centerX + plantRadius * 0.4}
        y={centerY - plantRadius * 0.1}
        radius={plantRadius * 0.7}
        fill={MAP2D_COLORS_PRO.plant}
        opacity={0.8}
        listening={false}
      />
      <Circle
        x={centerX}
        y={centerY + plantRadius * 0.2}
        radius={plantRadius * 0.6}
        fill={MAP2D_COLORS_PRO.plant}
        opacity={0.85}
        listening={false}
      />

      {/* Plant pot */}
      <Rect
        x={centerX - potRadius}
        y={canvasHeight - potHeight - 2}
        width={potRadius * 2}
        height={potHeight}
        fill={MAP2D_COLORS_PRO.plantPot}
        cornerRadius={[0, 0, 4, 4]}
        listening={false}
      />

      {/* Pot rim */}
      <Rect
        x={centerX - potRadius - 2}
        y={canvasHeight - potHeight - 4}
        width={potRadius * 2 + 4}
        height={4}
        fill={MAP2D_COLORS_PRO.plantPot}
        cornerRadius={2}
        listening={false}
      />

      {/* Selection/hover outline */}
      <Rect
        x={0}
        y={0}
        width={canvasWidth}
        height={canvasHeight}
        fill="transparent"
        stroke={getStroke()}
        strokeWidth={isSelected ? 3 : isHovered ? 2 : 0}
        cornerRadius={4}
        shadowColor="#000"
        shadowBlur={isDragging ? 10 : 0}
        shadowOpacity={0.3}
        shadowOffset={{ x: 2, y: 2 }}
      />
    </Group>
  )
}

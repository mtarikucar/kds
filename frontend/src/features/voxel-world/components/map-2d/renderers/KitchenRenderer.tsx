import { Rect, Circle, Line, Group } from 'react-konva'
import type { RendererProps } from './types'
import { MAP2D_COLORS_PRO } from './types'

interface KitchenRendererProps extends RendererProps {
  canvasWidth: number
  canvasHeight: number
}

export function KitchenRenderer({
  object,
  scale,
  isSelected,
  isHovered,
  isDragging,
  canvasWidth,
  canvasHeight,
}: KitchenRendererProps) {
  const cornerRadius = 3

  const getStroke = () => {
    if (isSelected) return MAP2D_COLORS_PRO.selected
    if (isHovered) return MAP2D_COLORS_PRO.hovered
    return MAP2D_COLORS_PRO.kitchenEquipment
  }

  // Calculate burner positions
  const burnerRadius = Math.min(canvasWidth, canvasHeight) * 0.12
  const burnerSpacing = Math.min(canvasWidth, canvasHeight) * 0.35
  const burners = [
    { x: canvasWidth * 0.3, y: canvasHeight * 0.3 },
    { x: canvasWidth * 0.7, y: canvasHeight * 0.3 },
    { x: canvasWidth * 0.3, y: canvasHeight * 0.7 },
    { x: canvasWidth * 0.7, y: canvasHeight * 0.7 },
  ].filter(
    (b) => b.x > burnerRadius && b.x < canvasWidth - burnerRadius && b.y > burnerRadius && b.y < canvasHeight - burnerRadius
  )

  return (
    <Group>
      {/* Shadow */}
      <Rect
        x={3}
        y={3}
        width={canvasWidth}
        height={canvasHeight}
        fill="rgba(0,0,0,0.25)"
        cornerRadius={cornerRadius}
        listening={false}
      />

      {/* Main surface (stainless steel) */}
      <Rect
        x={0}
        y={0}
        width={canvasWidth}
        height={canvasHeight}
        fill={MAP2D_COLORS_PRO.kitchen}
        stroke={getStroke()}
        strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
        cornerRadius={cornerRadius}
        shadowColor="#000"
        shadowBlur={isDragging ? 10 : 0}
        shadowOpacity={0.3}
        shadowOffset={{ x: 2, y: 2 }}
      />

      {/* Metallic shine effect */}
      <Rect
        x={4}
        y={4}
        width={canvasWidth - 8}
        height={8}
        fill={MAP2D_COLORS_PRO.kitchenSurface}
        opacity={0.4}
        cornerRadius={2}
        listening={false}
      />

      {/* Burners/stovetop pattern */}
      {burners.map((burner, i) => (
        <Group key={i}>
          {/* Outer ring */}
          <Circle
            x={burner.x}
            y={burner.y}
            radius={burnerRadius}
            fill={MAP2D_COLORS_PRO.kitchenEquipment}
            listening={false}
          />
          {/* Inner ring */}
          <Circle
            x={burner.x}
            y={burner.y}
            radius={burnerRadius * 0.6}
            fill={MAP2D_COLORS_PRO.kitchen}
            listening={false}
          />
          {/* Center */}
          <Circle
            x={burner.x}
            y={burner.y}
            radius={burnerRadius * 0.25}
            fill={MAP2D_COLORS_PRO.kitchenEquipment}
            listening={false}
          />
        </Group>
      ))}

      {/* Equipment divider lines */}
      <Line
        points={[canvasWidth * 0.5, 6, canvasWidth * 0.5, canvasHeight - 6]}
        stroke={MAP2D_COLORS_PRO.kitchenEquipment}
        strokeWidth={1}
        opacity={0.3}
        dash={[4, 4]}
        listening={false}
      />

      {/* Edge detail */}
      <Rect
        x={0}
        y={0}
        width={canvasWidth}
        height={3}
        fill={MAP2D_COLORS_PRO.kitchenSurface}
        opacity={0.5}
        listening={false}
      />
    </Group>
  )
}

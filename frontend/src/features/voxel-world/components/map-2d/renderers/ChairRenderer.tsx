import { Rect, Line, Group } from 'react-konva'
import type { RendererProps } from './types'
import { MAP2D_COLORS_PRO } from './types'

interface ChairRendererProps extends RendererProps {
  canvasWidth: number
  canvasHeight: number
}

export function ChairRenderer({
  object,
  scale,
  isSelected,
  isHovered,
  isDragging,
  canvasWidth,
  canvasHeight,
}: ChairRendererProps) {
  const cornerRadius = 2
  const backrestThickness = canvasHeight * 0.2
  const legSize = Math.min(canvasWidth, canvasHeight) * 0.1

  const getStroke = () => {
    if (isSelected) return MAP2D_COLORS_PRO.selected
    if (isHovered) return MAP2D_COLORS_PRO.hovered
    return '#00000033'
  }

  // Calculate backrest position based on rotation
  const rotation = object.rotation || 0
  let backrestX = 0
  let backrestY = 0
  let backrestW = canvasWidth
  let backrestH = backrestThickness

  // Backrest is at the "back" of the chair based on rotation
  switch (rotation) {
    case 0:
      // Facing down (backrest at top)
      backrestX = 0
      backrestY = 0
      break
    case 90:
      // Facing left (backrest at right)
      backrestX = canvasWidth - backrestThickness
      backrestY = 0
      backrestW = backrestThickness
      backrestH = canvasHeight
      break
    case 180:
      // Facing up (backrest at bottom)
      backrestX = 0
      backrestY = canvasHeight - backrestThickness
      break
    case 270:
      // Facing right (backrest at left)
      backrestX = 0
      backrestY = 0
      backrestW = backrestThickness
      backrestH = canvasHeight
      break
  }

  return (
    <Group>
      {/* Chair shadow */}
      <Rect
        x={2}
        y={2}
        width={canvasWidth}
        height={canvasHeight}
        fill="rgba(0,0,0,0.2)"
        cornerRadius={cornerRadius}
        listening={false}
      />

      {/* Chair seat */}
      <Rect
        x={0}
        y={0}
        width={canvasWidth}
        height={canvasHeight}
        fill={MAP2D_COLORS_PRO.chairSeat}
        stroke={getStroke()}
        strokeWidth={isSelected ? 2 : isHovered ? 1.5 : 1}
        cornerRadius={cornerRadius}
        shadowColor="#000"
        shadowBlur={isDragging ? 6 : 0}
        shadowOpacity={0.2}
        shadowOffset={{ x: 1, y: 1 }}
      />

      {/* Chair backrest (darker) */}
      <Rect
        x={backrestX}
        y={backrestY}
        width={backrestW}
        height={backrestH}
        fill={MAP2D_COLORS_PRO.chair}
        cornerRadius={cornerRadius}
        listening={false}
      />

      {/* Seat cushion indicator (lighter center) */}
      <Rect
        x={canvasWidth * 0.15}
        y={canvasHeight * 0.15}
        width={canvasWidth * 0.7}
        height={canvasHeight * 0.7}
        fill={MAP2D_COLORS_PRO.chairSeat}
        opacity={0.3}
        cornerRadius={cornerRadius}
        listening={false}
      />

      {/* Direction indicator (small triangle/line pointing forward) */}
      {(() => {
        const centerX = canvasWidth / 2
        const centerY = canvasHeight / 2
        const indicatorSize = Math.min(canvasWidth, canvasHeight) * 0.2
        let points: number[] = []

        switch (rotation) {
          case 0: // Facing down
            points = [centerX, canvasHeight - 4, centerX - indicatorSize / 2, canvasHeight - 4 - indicatorSize, centerX + indicatorSize / 2, canvasHeight - 4 - indicatorSize]
            break
          case 90: // Facing left
            points = [4, centerY, 4 + indicatorSize, centerY - indicatorSize / 2, 4 + indicatorSize, centerY + indicatorSize / 2]
            break
          case 180: // Facing up
            points = [centerX, 4, centerX - indicatorSize / 2, 4 + indicatorSize, centerX + indicatorSize / 2, 4 + indicatorSize]
            break
          case 270: // Facing right
            points = [canvasWidth - 4, centerY, canvasWidth - 4 - indicatorSize, centerY - indicatorSize / 2, canvasWidth - 4 - indicatorSize, centerY + indicatorSize / 2]
            break
        }

        return (
          <Line
            points={points}
            fill="rgba(255,255,255,0.3)"
            closed
            listening={false}
          />
        )
      })()}
    </Group>
  )
}

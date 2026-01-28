import { Rect, Line, Group } from 'react-konva'
import type { RendererProps } from './types'
import { MAP2D_COLORS_PRO } from './types'

interface WallRendererProps extends RendererProps {
  canvasWidth: number
  canvasHeight: number
}

export function WallRenderer({
  object,
  scale,
  isSelected,
  isHovered,
  canvasWidth,
  canvasHeight,
}: WallRendererProps) {
  const wallThickness = Math.max(canvasWidth, canvasHeight) * 0.15 // 15% of largest dimension

  // Determine wall orientation based on dimensions
  const isHorizontal = canvasWidth > canvasHeight

  const getStroke = () => {
    if (isSelected) return MAP2D_COLORS_PRO.selected
    if (isHovered) return MAP2D_COLORS_PRO.hovered
    return MAP2D_COLORS_PRO.wallShadow
  }

  // Create brick pattern lines
  const brickLines: { points: number[] }[] = []
  const brickSize = scale * 0.5 // Half unit bricks

  if (isHorizontal) {
    // Horizontal wall - vertical brick lines
    for (let x = brickSize; x < canvasWidth - brickSize / 2; x += brickSize) {
      brickLines.push({
        points: [x, 2, x, canvasHeight - 2],
      })
    }
  } else {
    // Vertical wall - horizontal brick lines
    for (let y = brickSize; y < canvasHeight - brickSize / 2; y += brickSize) {
      brickLines.push({
        points: [2, y, canvasWidth - 2, y],
      })
    }
  }

  return (
    <Group>
      {/* Wall shadow (offset) */}
      <Rect
        x={2}
        y={2}
        width={canvasWidth}
        height={canvasHeight}
        fill={MAP2D_COLORS_PRO.wallShadow}
        cornerRadius={1}
      />

      {/* Main wall body */}
      <Rect
        x={0}
        y={0}
        width={canvasWidth}
        height={canvasHeight}
        fill={MAP2D_COLORS_PRO.wall}
        stroke={getStroke()}
        strokeWidth={isSelected || isHovered ? 2 : 1}
        cornerRadius={1}
      />

      {/* Brick pattern (subtle) */}
      {brickLines.map((line, i) => (
        <Line
          key={i}
          points={line.points}
          stroke={MAP2D_COLORS_PRO.wallShadow}
          strokeWidth={0.5}
          opacity={0.4}
          listening={false}
        />
      ))}

      {/* Highlight on top/left edge */}
      <Line
        points={[0, canvasHeight, 0, 0, canvasWidth, 0]}
        stroke={MAP2D_COLORS_PRO.wallHighlight}
        strokeWidth={1}
        opacity={0.3}
        listening={false}
      />
    </Group>
  )
}

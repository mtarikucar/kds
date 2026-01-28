import { Rect, Line, Group } from 'react-konva'
import type { RendererProps } from './types'
import { MAP2D_COLORS_PRO } from './types'

interface BarRendererProps extends RendererProps {
  canvasWidth: number
  canvasHeight: number
}

export function BarRenderer({
  object,
  scale,
  isSelected,
  isHovered,
  isDragging,
  canvasWidth,
  canvasHeight,
}: BarRendererProps) {
  // Bar counter is typically long and narrow
  const isHorizontal = canvasWidth > canvasHeight
  const customerSideRadius = Math.min(canvasWidth, canvasHeight) * 0.3
  const footrestInset = isHorizontal ? 0 : canvasWidth * 0.15

  const getStroke = () => {
    if (isSelected) return MAP2D_COLORS_PRO.selected
    if (isHovered) return MAP2D_COLORS_PRO.hovered
    return MAP2D_COLORS_PRO.barFootrest
  }

  // Wood grain lines
  const grainLines: number[][] = []
  const grainCount = Math.floor((isHorizontal ? canvasWidth : canvasHeight) / (scale * 0.8))
  for (let i = 1; i < grainCount; i++) {
    const pos = (i / grainCount) * (isHorizontal ? canvasWidth : canvasHeight)
    if (isHorizontal) {
      grainLines.push([pos, 4, pos, canvasHeight - 4])
    } else {
      grainLines.push([4, pos, canvasWidth - 4, pos])
    }
  }

  return (
    <Group>
      {/* Shadow */}
      <Rect
        x={3}
        y={3}
        width={canvasWidth}
        height={canvasHeight}
        fill="rgba(0,0,0,0.3)"
        cornerRadius={isHorizontal ? [customerSideRadius, customerSideRadius, 4, 4] : [customerSideRadius, 4, 4, customerSideRadius]}
        listening={false}
      />

      {/* Main bar counter */}
      <Rect
        x={0}
        y={0}
        width={canvasWidth}
        height={canvasHeight}
        fill={MAP2D_COLORS_PRO.bar}
        stroke={getStroke()}
        strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
        cornerRadius={isHorizontal ? [customerSideRadius, customerSideRadius, 4, 4] : [customerSideRadius, 4, 4, customerSideRadius]}
        shadowColor="#000"
        shadowBlur={isDragging ? 10 : 0}
        shadowOpacity={0.3}
        shadowOffset={{ x: 2, y: 2 }}
      />

      {/* Bar top (lighter wood) */}
      <Rect
        x={4}
        y={4}
        width={canvasWidth - 8}
        height={canvasHeight - 8}
        fill={MAP2D_COLORS_PRO.barTop}
        cornerRadius={isHorizontal ? [customerSideRadius - 4, customerSideRadius - 4, 2, 2] : [customerSideRadius - 4, 2, 2, customerSideRadius - 4]}
        listening={false}
      />

      {/* Wood grain */}
      {grainLines.map((line, i) => (
        <Line
          key={i}
          points={line}
          stroke={MAP2D_COLORS_PRO.bar}
          strokeWidth={1}
          opacity={0.3}
          listening={false}
        />
      ))}

      {/* Footrest rail indicator (on customer side) */}
      <Line
        points={
          isHorizontal
            ? [8, canvasHeight - 4, canvasWidth - 8, canvasHeight - 4]
            : [canvasWidth - 4, 8, canvasWidth - 4, canvasHeight - 8]
        }
        stroke={MAP2D_COLORS_PRO.barFootrest}
        strokeWidth={3}
        lineCap="round"
        opacity={0.7}
        listening={false}
      />

      {/* Service side indicator (work area) */}
      <Line
        points={
          isHorizontal
            ? [8, 6, canvasWidth - 8, 6]
            : [6, 8, 6, canvasHeight - 8]
        }
        stroke={MAP2D_COLORS_PRO.barFootrest}
        strokeWidth={1}
        dash={[4, 2]}
        opacity={0.5}
        listening={false}
      />
    </Group>
  )
}

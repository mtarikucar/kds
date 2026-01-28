import { Rect, Line, Group } from 'react-konva'
import type { RendererProps } from './types'
import { MAP2D_COLORS_PRO } from './types'

interface WindowRendererProps extends RendererProps {
  canvasWidth: number
  canvasHeight: number
}

export function WindowRenderer({
  object,
  scale,
  isSelected,
  isHovered,
  canvasWidth,
  canvasHeight,
}: WindowRendererProps) {
  const frameWidth = 2
  const isHorizontal = canvasWidth > canvasHeight
  const paneCount = Math.max(2, Math.floor((isHorizontal ? canvasWidth : canvasHeight) / (scale * 1)))

  const getStroke = () => {
    if (isSelected) return MAP2D_COLORS_PRO.selected
    if (isHovered) return MAP2D_COLORS_PRO.hovered
    return MAP2D_COLORS_PRO.windowFrame
  }

  // Calculate pane dividers
  const dividers: { points: number[] }[] = []
  const paneWidth = (isHorizontal ? canvasWidth : canvasHeight) / paneCount

  for (let i = 1; i < paneCount; i++) {
    if (isHorizontal) {
      dividers.push({
        points: [paneWidth * i, frameWidth, paneWidth * i, canvasHeight - frameWidth],
      })
    } else {
      dividers.push({
        points: [frameWidth, paneWidth * i, canvasWidth - frameWidth, paneWidth * i],
      })
    }
  }

  // Center horizontal/vertical divider
  if (isHorizontal) {
    dividers.push({
      points: [frameWidth, canvasHeight / 2, canvasWidth - frameWidth, canvasHeight / 2],
    })
  } else {
    dividers.push({
      points: [canvasWidth / 2, frameWidth, canvasWidth / 2, canvasHeight - frameWidth],
    })
  }

  return (
    <Group>
      {/* Window frame */}
      <Rect
        x={0}
        y={0}
        width={canvasWidth}
        height={canvasHeight}
        fill={MAP2D_COLORS_PRO.windowFrame}
        stroke={getStroke()}
        strokeWidth={isSelected || isHovered ? 2 : 1}
        cornerRadius={1}
      />

      {/* Glass area */}
      <Rect
        x={frameWidth}
        y={frameWidth}
        width={canvasWidth - frameWidth * 2}
        height={canvasHeight - frameWidth * 2}
        fill={MAP2D_COLORS_PRO.windowGlass}
        cornerRadius={1}
      />

      {/* Glass shine effect */}
      <Rect
        x={frameWidth + 2}
        y={frameWidth + 2}
        width={(canvasWidth - frameWidth * 2) * 0.3}
        height={(canvasHeight - frameWidth * 2) * 0.4}
        fill="rgba(255, 255, 255, 0.3)"
        cornerRadius={1}
        listening={false}
      />

      {/* Pane dividers */}
      {dividers.map((divider, i) => (
        <Line
          key={i}
          points={divider.points}
          stroke={MAP2D_COLORS_PRO.windowFrame}
          strokeWidth={2}
          listening={false}
        />
      ))}
    </Group>
  )
}

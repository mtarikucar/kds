import { Rect, Line, Group } from 'react-konva'
import type { RendererProps } from './types'

interface FloorRendererProps extends RendererProps {
  canvasWidth: number
  canvasHeight: number
}

const FLOOR_COLORS = {
  tile: '#D4A574',
  tileDark: '#C49A6C',
  grout: '#8B7355',
}

export function FloorRenderer({
  object,
  scale,
  isSelected,
  isHovered,
  canvasWidth,
  canvasHeight,
}: FloorRendererProps) {
  const tileSize = scale * 1 // 1 unit tiles
  const tilesX = Math.ceil(canvasWidth / tileSize)
  const tilesY = Math.ceil(canvasHeight / tileSize)

  const getStroke = () => {
    if (isSelected) return '#3B82F6'
    if (isHovered) return '#60A5FA'
    return FLOOR_COLORS.grout
  }

  return (
    <Group>
      {/* Base floor */}
      <Rect
        x={0}
        y={0}
        width={canvasWidth}
        height={canvasHeight}
        fill={FLOOR_COLORS.tile}
        stroke={getStroke()}
        strokeWidth={isSelected || isHovered ? 2 : 1}
      />

      {/* Tile pattern */}
      {Array.from({ length: tilesX }).map((_, x) =>
        Array.from({ length: tilesY }).map((_, y) => {
          const isAlternate = (x + y) % 2 === 0
          return (
            <Rect
              key={`${x}-${y}`}
              x={x * tileSize}
              y={y * tileSize}
              width={tileSize}
              height={tileSize}
              fill={isAlternate ? FLOOR_COLORS.tile : FLOOR_COLORS.tileDark}
              stroke={FLOOR_COLORS.grout}
              strokeWidth={0.5}
              listening={false}
            />
          )
        })
      )}
    </Group>
  )
}

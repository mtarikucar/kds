import { Rect, Text, Line, Group } from 'react-konva'
import type { RendererProps } from './types'
import { MAP2D_COLORS_PRO } from './types'

interface ModelRendererProps extends RendererProps {
  canvasWidth: number
  canvasHeight: number
}

export function ModelRenderer({
  object,
  scale,
  isSelected,
  isHovered,
  isDragging,
  canvasWidth,
  canvasHeight,
}: ModelRendererProps) {
  const cornerRadius = 4

  const getStroke = () => {
    if (isSelected) return MAP2D_COLORS_PRO.selected
    if (isHovered) return MAP2D_COLORS_PRO.hovered
    return MAP2D_COLORS_PRO.modelOutline
  }

  const fontSize = Math.min(canvasWidth, canvasHeight) * 0.25
  const showLabel = object.label && fontSize >= 6

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

      {/* Main shape */}
      <Rect
        x={0}
        y={0}
        width={canvasWidth}
        height={canvasHeight}
        fill={MAP2D_COLORS_PRO.model}
        stroke={getStroke()}
        strokeWidth={isSelected ? 3 : isHovered ? 2 : 1.5}
        cornerRadius={cornerRadius}
        shadowColor="#000"
        shadowBlur={isDragging ? 10 : isSelected ? 5 : 0}
        shadowOpacity={isDragging ? 0.3 : isSelected ? 0.2 : 0}
        shadowOffset={{ x: 2, y: 2 }}
        dash={[4, 4]}
      />

      {/* 3D model indicator (cube icon) */}
      <Group x={canvasWidth / 2 - 12} y={canvasHeight / 2 - 12}>
        {/* Cube front face */}
        <Rect
          x={4}
          y={8}
          width={16}
          height={16}
          fill="transparent"
          stroke="rgba(255,255,255,0.6)"
          strokeWidth={1.5}
        />
        {/* Cube top face */}
        <Line
          points={[4, 8, 12, 0, 28, 0, 20, 8]}
          fill="rgba(255,255,255,0.3)"
          closed
          stroke="rgba(255,255,255,0.6)"
          strokeWidth={1}
        />
        {/* Cube right face */}
        <Line
          points={[20, 8, 28, 0, 28, 16, 20, 24]}
          fill="rgba(255,255,255,0.2)"
          closed
          stroke="rgba(255,255,255,0.6)"
          strokeWidth={1}
        />
      </Group>

      {/* Label */}
      {showLabel && (
        <Text
          x={0}
          y={canvasHeight - fontSize - 4}
          width={canvasWidth}
          text={object.label}
          fontSize={fontSize}
          fill="#fff"
          align="center"
          listening={false}
        />
      )}

      {/* Corner accents */}
      <Line
        points={[0, 8, 0, 0, 8, 0]}
        stroke={MAP2D_COLORS_PRO.modelOutline}
        strokeWidth={2}
        lineCap="round"
        listening={false}
      />
      <Line
        points={[canvasWidth - 8, 0, canvasWidth, 0, canvasWidth, 8]}
        stroke={MAP2D_COLORS_PRO.modelOutline}
        strokeWidth={2}
        lineCap="round"
        listening={false}
      />
      <Line
        points={[0, canvasHeight - 8, 0, canvasHeight, 8, canvasHeight]}
        stroke={MAP2D_COLORS_PRO.modelOutline}
        strokeWidth={2}
        lineCap="round"
        listening={false}
      />
      <Line
        points={[canvasWidth - 8, canvasHeight, canvasWidth, canvasHeight, canvasWidth, canvasHeight - 8]}
        stroke={MAP2D_COLORS_PRO.modelOutline}
        strokeWidth={2}
        lineCap="round"
        listening={false}
      />
    </Group>
  )
}

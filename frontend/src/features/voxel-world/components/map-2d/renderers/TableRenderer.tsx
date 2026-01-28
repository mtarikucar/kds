import { Rect, Circle, Ellipse, Text, Group, Line } from 'react-konva'
import type { RendererProps } from './types'
import { MAP2D_COLORS_PRO } from './types'

interface TableRendererProps extends RendererProps {
  canvasWidth: number
  canvasHeight: number
  status?: 'available' | 'occupied' | 'reserved'
}

export function TableRenderer({
  object,
  scale,
  isSelected,
  isHovered,
  isDragging,
  canvasWidth,
  canvasHeight,
  status = 'available',
}: TableRendererProps) {
  const shape = object.shape ?? 'rectangle'
  const capacity = object.capacity ?? 4

  // Status color for glow/indicator
  const statusColor = MAP2D_COLORS_PRO[status]

  const getStroke = () => {
    if (isSelected) return MAP2D_COLORS_PRO.selected
    if (isHovered) return MAP2D_COLORS_PRO.hovered
    return MAP2D_COLORS_PRO.tableShadow
  }

  // Label positioning
  const fontSize = Math.min(canvasWidth, canvasHeight) * 0.35
  const showLabel = object.label && fontSize >= 8

  // Render based on shape
  const renderTableShape = () => {
    switch (shape) {
      case 'round':
        return renderRoundTable()
      case 'oval':
        return renderOvalTable()
      case 'L-shaped':
        return renderLShapedTable()
      default:
        return renderRectangularTable()
    }
  }

  const renderRoundTable = () => {
    const radius = Math.min(canvasWidth, canvasHeight) / 2
    const centerX = canvasWidth / 2
    const centerY = canvasHeight / 2

    return (
      <Group>
        {/* Status glow */}
        <Circle
          x={centerX}
          y={centerY}
          radius={radius + 4}
          fill="transparent"
          stroke={statusColor}
          strokeWidth={3}
          opacity={0.4}
        />

        {/* Shadow */}
        <Circle
          x={centerX + 3}
          y={centerY + 3}
          radius={radius}
          fill={MAP2D_COLORS_PRO.tableShadow}
          opacity={0.5}
        />

        {/* Main table */}
        <Circle
          x={centerX}
          y={centerY}
          radius={radius}
          fill={MAP2D_COLORS_PRO.table}
          stroke={getStroke()}
          strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
          shadowColor="#000"
          shadowBlur={isDragging ? 10 : isSelected ? 5 : 0}
          shadowOpacity={isDragging ? 0.3 : isSelected ? 0.2 : 0}
          shadowOffset={{ x: 2, y: 2 }}
        />

        {/* Wood grain circles */}
        <Circle
          x={centerX}
          y={centerY}
          radius={radius * 0.7}
          fill="transparent"
          stroke={MAP2D_COLORS_PRO.tableTop}
          strokeWidth={1}
          opacity={0.2}
        />
        <Circle
          x={centerX}
          y={centerY}
          radius={radius * 0.4}
          fill="transparent"
          stroke={MAP2D_COLORS_PRO.tableTop}
          strokeWidth={1}
          opacity={0.15}
        />

        {/* Chair positions around the table */}
        {renderChairIndicators(centerX, centerY, radius, capacity, 'round')}

        {/* Status indicator */}
        <Circle
          x={centerX + radius * 0.6}
          y={centerY - radius * 0.6}
          radius={4}
          fill={statusColor}
          stroke="#fff"
          strokeWidth={1}
        />

        {/* Table number */}
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
            shadowColor="#000"
            shadowBlur={2}
            shadowOpacity={0.5}
          />
        )}
      </Group>
    )
  }

  const renderOvalTable = () => {
    const radiusX = canvasWidth / 2
    const radiusY = canvasHeight / 2
    const centerX = canvasWidth / 2
    const centerY = canvasHeight / 2

    return (
      <Group>
        {/* Status glow */}
        <Ellipse
          x={centerX}
          y={centerY}
          radiusX={radiusX + 4}
          radiusY={radiusY + 4}
          fill="transparent"
          stroke={statusColor}
          strokeWidth={3}
          opacity={0.4}
        />

        {/* Shadow */}
        <Ellipse
          x={centerX + 3}
          y={centerY + 3}
          radiusX={radiusX}
          radiusY={radiusY}
          fill={MAP2D_COLORS_PRO.tableShadow}
          opacity={0.5}
        />

        {/* Main table */}
        <Ellipse
          x={centerX}
          y={centerY}
          radiusX={radiusX}
          radiusY={radiusY}
          fill={MAP2D_COLORS_PRO.table}
          stroke={getStroke()}
          strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
          shadowColor="#000"
          shadowBlur={isDragging ? 10 : isSelected ? 5 : 0}
          shadowOpacity={isDragging ? 0.3 : isSelected ? 0.2 : 0}
          shadowOffset={{ x: 2, y: 2 }}
        />

        {/* Wood grain ellipses */}
        <Ellipse
          x={centerX}
          y={centerY}
          radiusX={radiusX * 0.7}
          radiusY={radiusY * 0.7}
          fill="transparent"
          stroke={MAP2D_COLORS_PRO.tableTop}
          strokeWidth={1}
          opacity={0.2}
        />

        {/* Chair positions */}
        {renderChairIndicators(centerX, centerY, Math.max(radiusX, radiusY), capacity, 'oval')}

        {/* Status indicator */}
        <Circle
          x={centerX + radiusX * 0.6}
          y={centerY - radiusY * 0.6}
          radius={4}
          fill={statusColor}
          stroke="#fff"
          strokeWidth={1}
        />

        {/* Table number */}
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
            shadowColor="#000"
            shadowBlur={2}
            shadowOpacity={0.5}
          />
        )}
      </Group>
    )
  }

  const renderLShapedTable = () => {
    // L-shaped table with two rectangles
    const longWidth = canvasWidth
    const longHeight = canvasHeight * 0.4
    const shortWidth = canvasWidth * 0.4
    const shortHeight = canvasHeight

    return (
      <Group>
        {/* Status glow - simplified rectangle */}
        <Rect
          x={-4}
          y={-4}
          width={canvasWidth + 8}
          height={canvasHeight + 8}
          fill="transparent"
          stroke={statusColor}
          strokeWidth={3}
          opacity={0.4}
          cornerRadius={4}
        />

        {/* Shadow */}
        <Rect
          x={3}
          y={3}
          width={longWidth}
          height={longHeight}
          fill={MAP2D_COLORS_PRO.tableShadow}
          opacity={0.5}
        />
        <Rect
          x={3}
          y={longHeight + 3}
          width={shortWidth}
          height={shortHeight - longHeight}
          fill={MAP2D_COLORS_PRO.tableShadow}
          opacity={0.5}
        />

        {/* Horizontal part */}
        <Rect
          x={0}
          y={0}
          width={longWidth}
          height={longHeight}
          fill={MAP2D_COLORS_PRO.table}
          stroke={getStroke()}
          strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
          cornerRadius={[4, 4, 0, 4]}
        />

        {/* Vertical part */}
        <Rect
          x={0}
          y={longHeight}
          width={shortWidth}
          height={shortHeight - longHeight}
          fill={MAP2D_COLORS_PRO.table}
          stroke={getStroke()}
          strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
          cornerRadius={[0, 0, 4, 4]}
        />

        {/* Status indicator */}
        <Circle
          x={canvasWidth - 8}
          y={8}
          radius={4}
          fill={statusColor}
          stroke="#fff"
          strokeWidth={1}
        />

        {/* Table number */}
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
            shadowColor="#000"
            shadowBlur={2}
            shadowOpacity={0.5}
          />
        )}
      </Group>
    )
  }

  const renderRectangularTable = () => {
    const cornerRadius = Math.min(canvasWidth, canvasHeight) * 0.12
    const legSize = Math.min(canvasWidth, canvasHeight) * 0.1
    const legInset = Math.min(canvasWidth, canvasHeight) * 0.06

    return (
      <Group>
        {/* Status glow (behind table) */}
        <Rect
          x={-4}
          y={-4}
          width={canvasWidth + 8}
          height={canvasHeight + 8}
          fill="transparent"
          stroke={statusColor}
          strokeWidth={3}
          cornerRadius={cornerRadius + 4}
          opacity={0.4}
        />

        {/* Table shadow */}
        <Rect
          x={3}
          y={3}
          width={canvasWidth}
          height={canvasHeight}
          fill={MAP2D_COLORS_PRO.tableShadow}
          cornerRadius={cornerRadius}
          opacity={0.5}
        />

        {/* Table legs (at corners) */}
        <Circle
          x={legInset + legSize / 2}
          y={legInset + legSize / 2}
          radius={legSize / 2}
          fill={MAP2D_COLORS_PRO.tableShadow}
        />
        <Circle
          x={canvasWidth - legInset - legSize / 2}
          y={legInset + legSize / 2}
          radius={legSize / 2}
          fill={MAP2D_COLORS_PRO.tableShadow}
        />
        <Circle
          x={legInset + legSize / 2}
          y={canvasHeight - legInset - legSize / 2}
          radius={legSize / 2}
          fill={MAP2D_COLORS_PRO.tableShadow}
        />
        <Circle
          x={canvasWidth - legInset - legSize / 2}
          y={canvasHeight - legInset - legSize / 2}
          radius={legSize / 2}
          fill={MAP2D_COLORS_PRO.tableShadow}
        />

        {/* Main table top */}
        <Rect
          x={0}
          y={0}
          width={canvasWidth}
          height={canvasHeight}
          fill={MAP2D_COLORS_PRO.table}
          stroke={getStroke()}
          strokeWidth={isSelected ? 3 : isHovered ? 2 : 1}
          cornerRadius={cornerRadius}
          shadowColor="#000"
          shadowBlur={isDragging ? 10 : isSelected ? 5 : 0}
          shadowOpacity={isDragging ? 0.3 : isSelected ? 0.2 : 0}
          shadowOffset={{ x: 2, y: 2 }}
        />

        {/* Wood grain effect */}
        <Rect
          x={canvasWidth * 0.1}
          y={canvasHeight * 0.3}
          width={canvasWidth * 0.8}
          height={1}
          fill={MAP2D_COLORS_PRO.tableTop}
          opacity={0.3}
        />
        <Rect
          x={canvasWidth * 0.15}
          y={canvasHeight * 0.5}
          width={canvasWidth * 0.7}
          height={1}
          fill={MAP2D_COLORS_PRO.tableTop}
          opacity={0.2}
        />
        <Rect
          x={canvasWidth * 0.1}
          y={canvasHeight * 0.7}
          width={canvasWidth * 0.8}
          height={1}
          fill={MAP2D_COLORS_PRO.tableTop}
          opacity={0.3}
        />

        {/* Chair indicators around the table */}
        {renderChairIndicators(canvasWidth / 2, canvasHeight / 2, Math.min(canvasWidth, canvasHeight) / 2, capacity, 'rectangle')}

        {/* Status indicator dot */}
        <Circle
          x={canvasWidth - 8}
          y={8}
          radius={4}
          fill={statusColor}
          stroke="#fff"
          strokeWidth={1}
        />

        {/* Table number label */}
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
            shadowColor="#000"
            shadowBlur={2}
            shadowOpacity={0.5}
          />
        )}
      </Group>
    )
  }

  // Render small indicators showing where chairs would be placed
  const renderChairIndicators = (
    centerX: number,
    centerY: number,
    tableRadius: number,
    numChairs: number,
    tableShape: string
  ) => {
    const chairIndicatorSize = Math.max(4, tableRadius * 0.15)
    const chairDistance = tableRadius + chairIndicatorSize + 4

    if (tableShape === 'round' || tableShape === 'oval') {
      // Distribute chairs evenly around the table
      return Array.from({ length: numChairs }).map((_, i) => {
        const angle = (i / numChairs) * Math.PI * 2 - Math.PI / 2
        const x = centerX + Math.cos(angle) * chairDistance
        const y = centerY + Math.sin(angle) * chairDistance

        return (
          <Rect
            key={i}
            x={x - chairIndicatorSize / 2}
            y={y - chairIndicatorSize / 2}
            width={chairIndicatorSize}
            height={chairIndicatorSize}
            fill={MAP2D_COLORS_PRO.chairSeat}
            cornerRadius={2}
            opacity={0.6}
          />
        )
      })
    }

    // For rectangular tables, place chairs on sides
    const chairs: JSX.Element[] = []
    const longSide = canvasWidth >= canvasHeight
    const longDim = longSide ? canvasWidth : canvasHeight
    const shortDim = longSide ? canvasHeight : canvasWidth

    // Calculate chairs per side based on capacity
    const chairsPerLongSide = Math.ceil(numChairs / 2)
    const chairsPerShortSide = Math.floor((numChairs - chairsPerLongSide * 2) / 2)

    // Top and bottom (or left and right for vertical tables)
    for (let i = 0; i < chairsPerLongSide; i++) {
      const offset = (longDim / (chairsPerLongSide + 1)) * (i + 1)

      if (longSide) {
        // Top
        chairs.push(
          <Rect
            key={`top-${i}`}
            x={offset - chairIndicatorSize / 2}
            y={-chairIndicatorSize - 4}
            width={chairIndicatorSize}
            height={chairIndicatorSize}
            fill={MAP2D_COLORS_PRO.chairSeat}
            cornerRadius={2}
            opacity={0.6}
          />
        )
        // Bottom
        chairs.push(
          <Rect
            key={`bottom-${i}`}
            x={offset - chairIndicatorSize / 2}
            y={canvasHeight + 4}
            width={chairIndicatorSize}
            height={chairIndicatorSize}
            fill={MAP2D_COLORS_PRO.chairSeat}
            cornerRadius={2}
            opacity={0.6}
          />
        )
      } else {
        // Left
        chairs.push(
          <Rect
            key={`left-${i}`}
            x={-chairIndicatorSize - 4}
            y={offset - chairIndicatorSize / 2}
            width={chairIndicatorSize}
            height={chairIndicatorSize}
            fill={MAP2D_COLORS_PRO.chairSeat}
            cornerRadius={2}
            opacity={0.6}
          />
        )
        // Right
        chairs.push(
          <Rect
            key={`right-${i}`}
            x={canvasWidth + 4}
            y={offset - chairIndicatorSize / 2}
            width={chairIndicatorSize}
            height={chairIndicatorSize}
            fill={MAP2D_COLORS_PRO.chairSeat}
            cornerRadius={2}
            opacity={0.6}
          />
        )
      }
    }

    // Head chairs for larger tables
    if (numChairs > 4 && chairsPerShortSide > 0) {
      if (longSide) {
        // Left head
        chairs.push(
          <Rect
            key="head-left"
            x={-chairIndicatorSize - 4}
            y={canvasHeight / 2 - chairIndicatorSize / 2}
            width={chairIndicatorSize}
            height={chairIndicatorSize}
            fill={MAP2D_COLORS_PRO.chairSeat}
            cornerRadius={2}
            opacity={0.6}
          />
        )
        // Right head
        chairs.push(
          <Rect
            key="head-right"
            x={canvasWidth + 4}
            y={canvasHeight / 2 - chairIndicatorSize / 2}
            width={chairIndicatorSize}
            height={chairIndicatorSize}
            fill={MAP2D_COLORS_PRO.chairSeat}
            cornerRadius={2}
            opacity={0.6}
          />
        )
      } else {
        // Top head
        chairs.push(
          <Rect
            key="head-top"
            x={canvasWidth / 2 - chairIndicatorSize / 2}
            y={-chairIndicatorSize - 4}
            width={chairIndicatorSize}
            height={chairIndicatorSize}
            fill={MAP2D_COLORS_PRO.chairSeat}
            cornerRadius={2}
            opacity={0.6}
          />
        )
        // Bottom head
        chairs.push(
          <Rect
            key="head-bottom"
            x={canvasWidth / 2 - chairIndicatorSize / 2}
            y={canvasHeight + 4}
            width={chairIndicatorSize}
            height={chairIndicatorSize}
            fill={MAP2D_COLORS_PRO.chairSeat}
            cornerRadius={2}
            opacity={0.6}
          />
        )
      }
    }

    return chairs
  }

  return renderTableShape()
}

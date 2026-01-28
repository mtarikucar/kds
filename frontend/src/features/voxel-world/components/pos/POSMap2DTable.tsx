import { useRef, useEffect } from 'react'
import { Rect, Group, Text, Circle } from 'react-konva'
import type Konva from 'konva'
import type { Map2DObject as Map2DObjectType } from '../../types/map2d'

// Design tokens for table status colors
const TABLE_COLORS = {
  available: '#22C55E',
  occupied: '#EF4444',
  reserved: '#F59E0B',
  selected: '#3B82F6',
  hover: 'rgba(59, 130, 246, 0.3)',
}

// Badge colors
const BADGE_COLORS = {
  orders: '#F59E0B', // amber
  waiter: '#3B82F6', // blue
  bill: '#A855F7', // purple
}

interface TableNotifications {
  orders: number
  waiter: number
  bill: number
}

interface POSMap2DTableProps {
  object: Map2DObjectType
  scale: number
  isSelected: boolean
  isHovered: boolean
  status: 'available' | 'occupied' | 'reserved'
  notifications?: TableNotifications
  onClick: (id: string) => void
  onMouseEnter: (id: string) => void
  onMouseLeave: (id: string) => void
}

export function POSMap2DTable({
  object,
  scale,
  isSelected,
  isHovered,
  status,
  notifications,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: POSMap2DTableProps) {
  const groupRef = useRef<Konva.Group>(null)

  // Handle dimension swapping for 90/270 degree rotations
  const isRotated90or270 = object.rotation === 90 || object.rotation === 270
  const effectiveWidth = isRotated90or270 ? object.depth : object.width
  const effectiveHeight = isRotated90or270 ? object.width : object.depth

  // Convert world coordinates to canvas coordinates
  const canvasX = object.x * scale
  const canvasY = object.z * scale
  const canvasWidth = effectiveWidth * scale
  const canvasHeight = effectiveHeight * scale

  // Get fill color based on status
  const getFillColor = () => {
    if (isSelected) return TABLE_COLORS.selected
    return TABLE_COLORS[status]
  }

  // Calculate stroke based on state
  const getStroke = () => {
    if (isSelected) return '#fff'
    if (isHovered) return 'rgba(255, 255, 255, 0.8)'
    return 'rgba(0, 0, 0, 0.3)'
  }

  const getStrokeWidth = () => {
    if (isSelected) return 3
    if (isHovered) return 2
    return 1
  }

  // Reset position when object position changes
  useEffect(() => {
    if (groupRef.current) {
      groupRef.current.x(canvasX)
      groupRef.current.y(canvasY)
    }
  }, [canvasX, canvasY])

  // Calculate text size based on object dimensions
  const fontSize = Math.min(canvasWidth, canvasHeight) * 0.35
  const showLabel = object.label && fontSize >= 8

  // Badge settings
  const badgeRadius = Math.max(8, Math.min(canvasWidth, canvasHeight) * 0.12)
  const badgeSpacing = badgeRadius * 2.2
  const hasNotifications =
    notifications && (notifications.orders > 0 || notifications.waiter > 0 || notifications.bill > 0)

  // Calculate badge positions (top-right corner)
  const getBadgePositions = () => {
    const badges: Array<{ x: number; y: number; color: string; count: number }> = []
    if (!notifications) return badges

    let index = 0
    if (notifications.orders > 0) {
      badges.push({
        x: canvasWidth - badgeRadius - index * badgeSpacing,
        y: -badgeRadius,
        color: BADGE_COLORS.orders,
        count: notifications.orders,
      })
      index++
    }
    if (notifications.waiter > 0) {
      badges.push({
        x: canvasWidth - badgeRadius - index * badgeSpacing,
        y: -badgeRadius,
        color: BADGE_COLORS.waiter,
        count: notifications.waiter,
      })
      index++
    }
    if (notifications.bill > 0) {
      badges.push({
        x: canvasWidth - badgeRadius - index * badgeSpacing,
        y: -badgeRadius,
        color: BADGE_COLORS.bill,
        count: notifications.bill,
      })
    }
    return badges
  }

  return (
    <Group
      ref={groupRef}
      x={canvasX}
      y={canvasY}
      onClick={() => onClick(object.id)}
      onTap={() => onClick(object.id)}
      onMouseEnter={() => onMouseEnter(object.id)}
      onMouseLeave={() => onMouseLeave(object.id)}
    >
      {/* Hover highlight */}
      {isHovered && !isSelected && (
        <Rect
          x={-4}
          y={-4}
          width={canvasWidth + 8}
          height={canvasHeight + 8}
          fill={TABLE_COLORS.hover}
          cornerRadius={8}
        />
      )}

      {/* Main table shape */}
      <Rect
        x={0}
        y={0}
        width={canvasWidth}
        height={canvasHeight}
        fill={getFillColor()}
        stroke={getStroke()}
        strokeWidth={getStrokeWidth()}
        cornerRadius={6}
        shadowColor="#000"
        shadowBlur={isSelected ? 12 : isHovered ? 8 : 4}
        shadowOpacity={isSelected ? 0.4 : isHovered ? 0.3 : 0.2}
        shadowOffset={{ x: 2, y: 2 }}
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
          listening={false}
          shadowColor="#000"
          shadowBlur={2}
          shadowOpacity={0.5}
        />
      )}

      {/* Notification badges */}
      {hasNotifications &&
        getBadgePositions().map((badge, index) => (
          <Group key={index} x={badge.x} y={badge.y}>
            {/* Badge circle */}
            <Circle
              radius={badgeRadius}
              fill={badge.color}
              stroke="#fff"
              strokeWidth={2}
              shadowColor="#000"
              shadowBlur={4}
              shadowOpacity={0.3}
            />
            {/* Badge count (only if > 1 or big enough) */}
            {badge.count > 1 && badgeRadius >= 10 && (
              <Text
                x={-badgeRadius}
                y={-badgeRadius}
                width={badgeRadius * 2}
                height={badgeRadius * 2}
                text={String(badge.count)}
                fontSize={badgeRadius * 0.9}
                fontStyle="bold"
                fill="#fff"
                align="center"
                verticalAlign="middle"
                listening={false}
              />
            )}
          </Group>
        ))}
    </Group>
  )
}

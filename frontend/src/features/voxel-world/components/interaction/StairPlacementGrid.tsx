import { useState, useMemo } from 'react'
import * as THREE from 'three'
import { useStairEditor } from '../../hooks/useStairEditor'
import type { StairSide } from '../../types/voxel'
import { getNeighborPosition } from '../../utils/procedural/stairGenerator'

interface StairPlacementGridProps {
  enabled?: boolean
}

const INDICATOR_COLORS = {
  valid: '#22c55e', // Green - can place
  existing: '#3b82f6', // Blue - existing stair
  invalid: '#ef4444', // Red - cannot place
  hover: '#fbbf24', // Yellow - hover state
} as const

/**
 * Get the position offset for a stair indicator based on side
 */
function getIndicatorOffset(side: StairSide): [number, number, number] {
  switch (side) {
    case 'n':
      return [0.5, 0, 0]
    case 's':
      return [0.5, 0, 1]
    case 'e':
      return [1, 0, 0.5]
    case 'w':
      return [0, 0, 0.5]
  }
}

/**
 * Get the rotation for a stair indicator based on side
 */
function getIndicatorRotation(side: StairSide): [number, number, number] {
  switch (side) {
    case 'n':
    case 's':
      return [0, 0, 0]
    case 'e':
    case 'w':
      return [0, Math.PI / 2, 0]
  }
}

interface StairIndicatorProps {
  x: number
  z: number
  level: number
  side: StairSide
  canPlace: boolean
  hasStair: boolean
  onStairClick: (
    x: number,
    z: number,
    level: number,
    side: StairSide,
    isRightClick: boolean
  ) => void
}

function StairIndicator({
  x,
  z,
  level,
  side,
  canPlace,
  hasStair,
  onStairClick,
}: StairIndicatorProps) {
  const [isHovered, setIsHovered] = useState(false)

  const offset = getIndicatorOffset(side)
  const rotation = getIndicatorRotation(side)
  const baseY = level * 1 + 0.02 // Slightly above the floor level

  const color = useMemo(() => {
    if (isHovered) return INDICATOR_COLORS.hover
    if (hasStair) return INDICATOR_COLORS.existing
    if (canPlace) return INDICATOR_COLORS.valid
    return INDICATOR_COLORS.invalid
  }, [isHovered, hasStair, canPlace])

  const handleClick = (event: { stopPropagation?: () => void; button?: number }) => {
    event.stopPropagation?.()
    const isRightClick = event.button === 2
    onStairClick(x, z, level, side, isRightClick)
  }

  const handleContextMenu = (event: { stopPropagation?: () => void; preventDefault?: () => void }) => {
    event.stopPropagation?.()
    event.preventDefault?.()
    onStairClick(x, z, level, side, true)
  }

  // Don't show indicators for invalid placements unless they already have stairs
  if (!canPlace && !hasStair) return null

  return (
    <group position={[x + offset[0], baseY + offset[1], z + offset[2]]}>
      <mesh
        rotation={rotation}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onPointerEnter={(e) => {
          e.stopPropagation()
          setIsHovered(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerLeave={(e) => {
          e.stopPropagation()
          setIsHovered(false)
          document.body.style.cursor = 'auto'
        }}
      >
        {/* Stair indicator - a small arrow/chevron shape */}
        <boxGeometry args={[0.8, 0.08, 0.3]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={isHovered ? 0.9 : 0.7}
          emissive={color}
          emissiveIntensity={isHovered ? 0.3 : 0.1}
        />
      </mesh>

      {/* Direction indicator arrow */}
      <mesh
        position={[0, 0.05, side === 'n' || side === 'w' ? 0.2 : -0.2]}
        rotation={[
          side === 'n' ? -Math.PI / 4 : side === 's' ? Math.PI / 4 : 0,
          0,
          side === 'e' ? -Math.PI / 4 : side === 'w' ? Math.PI / 4 : 0,
        ]}
      >
        <boxGeometry args={[0.15, 0.04, 0.15]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={isHovered ? 0.9 : 0.6}
        />
      </mesh>
    </group>
  )
}

export function StairPlacementGrid({ enabled = true }: StairPlacementGridProps) {
  const { isStairToolActive, getStairPlacements, handleStairClick } =
    useStairEditor({ enabled })

  const placements = useMemo(() => {
    if (!enabled || !isStairToolActive) return []
    return getStairPlacements()
  }, [enabled, isStairToolActive, getStairPlacements])

  if (!enabled || !isStairToolActive || placements.length === 0) {
    return null
  }

  return (
    <group name="stair-placement-grid">
      {placements.map((placement) => (
        <StairIndicator
          key={`stair-${placement.x}-${placement.z}-${placement.level}-${placement.side}`}
          x={placement.x}
          z={placement.z}
          level={placement.level}
          side={placement.side}
          canPlace={placement.canPlace}
          hasStair={placement.hasStair}
          onStairClick={handleStairClick}
        />
      ))}
    </group>
  )
}

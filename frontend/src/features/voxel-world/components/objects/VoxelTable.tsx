import { useRef } from 'react'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import type { TableStatus } from '@/types'
import { VOXEL_COLORS, type VoxelPosition, type VoxelRotation } from '../../types/voxel'

interface VoxelTableProps {
  position: VoxelPosition
  rotation: VoxelRotation
  status: TableStatus
  tableNumber: string
  capacity: number
  isSelected: boolean
  isEditorMode: boolean
  onClick?: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

function getStatusColor(status: TableStatus): string {
  switch (status) {
    case 'AVAILABLE':
      return VOXEL_COLORS.available
    case 'OCCUPIED':
      return VOXEL_COLORS.occupied
    case 'RESERVED':
      return VOXEL_COLORS.reserved
    default:
      return VOXEL_COLORS.tableWood
  }
}

function getTableSize(capacity: number): { width: number; depth: number } {
  if (capacity <= 2) return { width: 2, depth: 2 }
  if (capacity <= 4) return { width: 3, depth: 3 }
  if (capacity <= 6) return { width: 4, depth: 3 }
  return { width: 5, depth: 3 }
}

export function VoxelTableObject({
  position,
  rotation,
  status,
  tableNumber,
  capacity,
  isSelected,
  isEditorMode,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: VoxelTableProps) {
  const groupRef = useRef<THREE.Group>(null)

  const { width, depth } = getTableSize(capacity)
  const tableHeight = 0.8
  const legHeight = 0.7
  const topThickness = 0.1

  const statusColor = getStatusColor(status)

  return (
    <group
      ref={groupRef}
      position={[position.x + width / 2, position.y, position.z + depth / 2]}
      rotation={[0, (rotation.y * Math.PI) / 180, 0]}
      onClick={onClick}
      onPointerOver={(e) => {
        e.stopPropagation()
        document.body.style.cursor = 'pointer'
        onPointerEnter?.()
      }}
      onPointerOut={(e) => {
        e.stopPropagation()
        document.body.style.cursor = 'auto'
        onPointerLeave?.()
      }}
    >
      {/* Table top */}
      <mesh
        position={[0, legHeight + topThickness / 2, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[width - 0.2, topThickness, depth - 0.2]} />
        <meshStandardMaterial
          color={VOXEL_COLORS.tableWood}
          roughness={0.7}
          metalness={0.1}
        />
      </mesh>

      {/* Table legs */}
      {[
        [-width / 2 + 0.3, -depth / 2 + 0.3],
        [width / 2 - 0.3, -depth / 2 + 0.3],
        [-width / 2 + 0.3, depth / 2 - 0.3],
        [width / 2 - 0.3, depth / 2 - 0.3],
      ].map(([x, z], i) => (
        <mesh
          key={i}
          position={[x, legHeight / 2, z]}
          castShadow
        >
          <boxGeometry args={[0.15, legHeight, 0.15]} />
          <meshStandardMaterial
            color={VOXEL_COLORS.tableWood}
            roughness={0.8}
            metalness={0}
          />
        </mesh>
      ))}

      {/* Status indicator (glowing plate on table) */}
      <mesh
        position={[0, tableHeight + 0.05, 0]}
        receiveShadow
      >
        <cylinderGeometry args={[0.4, 0.4, 0.08, 16]} />
        <meshStandardMaterial
          color={statusColor}
          emissive={statusColor}
          emissiveIntensity={0.5}
          roughness={0.3}
          metalness={0.5}
        />
      </mesh>

      {/* Table number label */}
      <Text
        position={[0, tableHeight + 0.3, 0]}
        rotation={[-Math.PI / 4, 0, 0]}
        fontSize={0.4}
        color="#ffffff"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#000000"
      >
        {tableNumber}
      </Text>

      {/* Capacity indicator */}
      <Text
        position={[0, tableHeight + 0.15, 0.3]}
        rotation={[-Math.PI / 4, 0, 0]}
        fontSize={0.15}
        color="#cccccc"
        anchorX="center"
        anchorY="middle"
      >
        {capacity} seats
      </Text>

      {/* Selection highlight */}
      {isSelected && isEditorMode && (
        <mesh position={[0, tableHeight / 2, 0]}>
          <boxGeometry args={[width + 0.1, tableHeight + 0.1, depth + 0.1]} />
          <meshBasicMaterial
            color={VOXEL_COLORS.selected}
            transparent
            opacity={0.3}
            wireframe
          />
        </mesh>
      )}
    </group>
  )
}

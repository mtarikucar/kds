import { useRef, useState } from 'react'
import * as THREE from 'three'
import { VOXEL_COLORS, type VoxelPosition, type VoxelRotation } from '../../types/voxel'

interface VoxelChairProps {
  position: VoxelPosition
  rotation: VoxelRotation
  isSelected: boolean
  isHovered: boolean
  isEditorMode: boolean
  onClick?: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

export function VoxelChair({
  position,
  rotation,
  isSelected,
  isHovered,
  isEditorMode,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: VoxelChairProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [hoverLocal, setHoverLocal] = useState(false)

  const seatWidth = 0.5
  const seatDepth = 0.5
  const seatHeight = 0.45
  const backHeight = 0.5
  const legHeight = 0.4

  const highlightColor = isSelected
    ? VOXEL_COLORS.selected
    : isHovered || hoverLocal
    ? VOXEL_COLORS.hovered
    : null

  const handlePointerEnter = () => {
    setHoverLocal(true)
    onPointerEnter?.()
  }

  const handlePointerLeave = () => {
    setHoverLocal(false)
    onPointerLeave?.()
  }

  return (
    <group
      ref={groupRef}
      position={[position.x + 0.5, position.y, position.z + 0.5]}
      rotation={[0, (rotation.y * Math.PI) / 180, 0]}
      onClick={onClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {/* Seat */}
      <mesh position={[0, legHeight + 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[seatWidth, 0.08, seatDepth]} />
        <meshStandardMaterial
          color={VOXEL_COLORS.chairFabric}
          roughness={0.9}
          metalness={0}
        />
      </mesh>

      {/* Backrest */}
      <mesh
        position={[0, legHeight + 0.05 + backHeight / 2, -seatDepth / 2 + 0.04]}
        castShadow
      >
        <boxGeometry args={[seatWidth, backHeight, 0.08]} />
        <meshStandardMaterial
          color={VOXEL_COLORS.chairFabric}
          roughness={0.9}
          metalness={0}
        />
      </mesh>

      {/* Legs */}
      {[
        [-seatWidth / 2 + 0.08, -seatDepth / 2 + 0.08],
        [seatWidth / 2 - 0.08, -seatDepth / 2 + 0.08],
        [-seatWidth / 2 + 0.08, seatDepth / 2 - 0.08],
        [seatWidth / 2 - 0.08, seatDepth / 2 - 0.08],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, legHeight / 2, z]} castShadow>
          <boxGeometry args={[0.06, legHeight, 0.06]} />
          <meshStandardMaterial
            color={VOXEL_COLORS.tableWood}
            roughness={0.8}
            metalness={0}
          />
        </mesh>
      ))}

      {/* Selection/hover highlight */}
      {highlightColor && isEditorMode && (
        <mesh position={[0, seatHeight / 2 + 0.2, 0]}>
          <boxGeometry args={[seatWidth + 0.1, seatHeight + backHeight, seatDepth + 0.1]} />
          <meshBasicMaterial
            color={highlightColor}
            transparent
            opacity={0.3}
            wireframe
          />
        </mesh>
      )}
    </group>
  )
}

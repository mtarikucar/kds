import { useRef, useState } from 'react'
import * as THREE from 'three'
import { VOXEL_COLORS, type VoxelPosition, type VoxelRotation } from '../../types/voxel'

interface VoxelBarProps {
  position: VoxelPosition
  rotation: VoxelRotation
  isSelected: boolean
  isHovered: boolean
  isEditorMode: boolean
  onClick?: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

export function VoxelBar({
  position,
  rotation,
  isSelected,
  isHovered,
  isEditorMode,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: VoxelBarProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [hoverLocal, setHoverLocal] = useState(false)

  const width = 4
  const depth = 1
  const counterHeight = 1.1
  const baseHeight = 0.9

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
      position={[position.x + width / 2, position.y, position.z + depth / 2]}
      rotation={[0, (rotation.y * Math.PI) / 180, 0]}
      onClick={onClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {/* Bar base */}
      <mesh position={[0, baseHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width - 0.1, baseHeight, depth - 0.1]} />
        <meshStandardMaterial
          color={VOXEL_COLORS.bar}
          roughness={0.7}
          metalness={0.1}
        />
      </mesh>

      {/* Bar counter top */}
      <mesh position={[0, baseHeight + 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.1, depth + 0.3]} />
        <meshStandardMaterial
          color={VOXEL_COLORS.tableWood}
          roughness={0.5}
          metalness={0.1}
        />
      </mesh>

      {/* Bar overhang (customer side) */}
      <mesh position={[0, counterHeight + 0.05, depth / 2 + 0.15]} castShadow>
        <boxGeometry args={[width, 0.08, 0.4]} />
        <meshStandardMaterial
          color={VOXEL_COLORS.tableWood}
          roughness={0.5}
          metalness={0.1}
        />
      </mesh>

      {/* Footrest */}
      <mesh position={[0, 0.25, depth / 2 + 0.3]} castShadow>
        <boxGeometry args={[width - 0.4, 0.05, 0.1]} />
        <meshStandardMaterial
          color="#666666"
          roughness={0.3}
          metalness={0.7}
        />
      </mesh>

      {/* Decorative panels */}
      {[-1.5, -0.5, 0.5, 1.5].map((x, i) => (
        <mesh key={i} position={[x, baseHeight / 2, -depth / 2 + 0.06]} castShadow>
          <boxGeometry args={[0.6, baseHeight - 0.2, 0.02]} />
          <meshStandardMaterial
            color="#5D3A1A"
            roughness={0.8}
            metalness={0}
          />
        </mesh>
      ))}

      {/* Selection/hover highlight */}
      {highlightColor && isEditorMode && (
        <mesh position={[0, counterHeight / 2, 0]}>
          <boxGeometry args={[width + 0.1, counterHeight + 0.2, depth + 0.5]} />
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

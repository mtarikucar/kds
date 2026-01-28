import { useRef, useState } from 'react'
import * as THREE from 'three'
import { VOXEL_COLORS, type VoxelPosition, type VoxelRotation } from '../../types/voxel'

interface VoxelKitchenProps {
  position: VoxelPosition
  rotation: VoxelRotation
  isSelected: boolean
  isHovered: boolean
  isEditorMode: boolean
  onClick?: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

export function VoxelKitchen({
  position,
  rotation,
  isSelected,
  isHovered,
  isEditorMode,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: VoxelKitchenProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [hoverLocal, setHoverLocal] = useState(false)

  const width = 3
  const depth = 2
  const counterHeight = 0.9
  const shelfHeight = 1.5

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
      {/* Counter base */}
      <mesh position={[0, counterHeight / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[width - 0.1, counterHeight, depth - 0.1]} />
        <meshStandardMaterial
          color={VOXEL_COLORS.kitchen}
          roughness={0.6}
          metalness={0.3}
        />
      </mesh>

      {/* Counter top (stainless steel look) */}
      <mesh position={[0, counterHeight + 0.03, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.06, depth]} />
        <meshStandardMaterial
          color="#A8A8A8"
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>

      {/* Back shelf */}
      <mesh position={[0, counterHeight + shelfHeight / 2, -depth / 2 + 0.1]} castShadow>
        <boxGeometry args={[width - 0.2, shelfHeight, 0.2]} />
        <meshStandardMaterial
          color={VOXEL_COLORS.kitchen}
          roughness={0.6}
          metalness={0.3}
        />
      </mesh>

      {/* Shelf surfaces */}
      {[0.4, 0.8, 1.2].map((h, i) => (
        <mesh key={i} position={[0, counterHeight + h, -depth / 2 + 0.25]} castShadow>
          <boxGeometry args={[width - 0.3, 0.04, 0.3]} />
          <meshStandardMaterial
            color="#A8A8A8"
            roughness={0.2}
            metalness={0.8}
          />
        </mesh>
      ))}

      {/* Stove burners */}
      {[
        [-0.5, 0.3],
        [0.5, 0.3],
        [-0.5, -0.3],
        [0.5, -0.3],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, counterHeight + 0.07, z]} receiveShadow>
          <cylinderGeometry args={[0.2, 0.2, 0.02, 16]} />
          <meshStandardMaterial
            color="#333333"
            roughness={0.3}
            metalness={0.7}
          />
        </mesh>
      ))}

      {/* Selection/hover highlight */}
      {highlightColor && isEditorMode && (
        <mesh position={[0, (counterHeight + shelfHeight) / 2, 0]}>
          <boxGeometry args={[width + 0.1, counterHeight + shelfHeight + 0.1, depth + 0.1]} />
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

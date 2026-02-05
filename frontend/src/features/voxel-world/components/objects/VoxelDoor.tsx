import { useRef, useState } from 'react'
import * as THREE from 'three'
import { VOXEL_COLORS, type VoxelPosition, type VoxelRotation } from '../../types/voxel'

interface VoxelDoorProps {
  position: VoxelPosition
  rotation: VoxelRotation
  isSelected: boolean
  isEditorMode: boolean
  onClick?: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

const DOOR_COLORS = {
  frame: '#5C4710',
  panel: '#8B6914',
  handle: '#C0C0C0',
} as const

export function VoxelDoor({
  position,
  rotation,
  isSelected,
  isEditorMode,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: VoxelDoorProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [isOpen, setIsOpen] = useState(false)

  const doorWidth = 1
  const doorHeight = 2
  const doorDepth = 0.15
  const frameThickness = 0.08
  const panelInset = 0.02

  const handleClick = () => {
    if (isEditorMode) {
      onClick?.()
    } else {
      setIsOpen((prev) => !prev)
    }
  }

  return (
    <group
      ref={groupRef}
      position={[position.x + 0.5, position.y, position.z + 0.5]}
      rotation={[0, (rotation.y * Math.PI) / 180, 0]}
      onClick={handleClick}
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
      {/* Left Frame */}
      <mesh
        position={[-doorWidth / 2 + frameThickness / 2, doorHeight / 2, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[frameThickness, doorHeight, doorDepth]} />
        <meshStandardMaterial color={DOOR_COLORS.frame} roughness={0.7} metalness={0} />
      </mesh>

      {/* Right Frame */}
      <mesh
        position={[doorWidth / 2 - frameThickness / 2, doorHeight / 2, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[frameThickness, doorHeight, doorDepth]} />
        <meshStandardMaterial color={DOOR_COLORS.frame} roughness={0.7} metalness={0} />
      </mesh>

      {/* Top Frame */}
      <mesh
        position={[0, doorHeight - frameThickness / 2, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[doorWidth, frameThickness, doorDepth]} />
        <meshStandardMaterial color={DOOR_COLORS.frame} roughness={0.7} metalness={0} />
      </mesh>

      {/* Door Panel - rotates when open */}
      <group
        position={[-doorWidth / 2 + frameThickness + panelInset, 0, 0]}
        rotation={[0, isOpen ? -Math.PI / 2 : 0, 0]}
      >
        <mesh
          position={[(doorWidth - frameThickness * 2 - panelInset * 2) / 2, doorHeight / 2, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry
            args={[
              doorWidth - frameThickness * 2 - panelInset * 2,
              doorHeight - frameThickness,
              doorDepth - 0.04,
            ]}
          />
          <meshStandardMaterial color={DOOR_COLORS.panel} roughness={0.6} metalness={0} />
        </mesh>

        {/* Door Handle */}
        <mesh
          position={[
            doorWidth - frameThickness * 2 - panelInset * 2 - 0.15,
            doorHeight / 2,
            doorDepth / 2,
          ]}
          castShadow
        >
          <boxGeometry args={[0.08, 0.04, 0.06]} />
          <meshStandardMaterial
            color={DOOR_COLORS.handle}
            roughness={0.3}
            metalness={0.8}
          />
        </mesh>
      </group>

      {/* Selection highlight */}
      {isSelected && isEditorMode && (
        <mesh position={[0, doorHeight / 2, 0]}>
          <boxGeometry args={[doorWidth + 0.1, doorHeight + 0.1, doorDepth + 0.1]} />
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

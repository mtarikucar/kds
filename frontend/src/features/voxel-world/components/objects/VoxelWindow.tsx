import { useRef } from 'react'
import * as THREE from 'three'
import { VOXEL_COLORS, type VoxelPosition, type VoxelRotation } from '../../types/voxel'

interface VoxelWindowProps {
  position: VoxelPosition
  rotation: VoxelRotation
  isSelected: boolean
  isEditorMode: boolean
  onClick?: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

const WINDOW_COLORS = {
  frame: '#F5F5F5', // White frame
  glass: '#87CEEB', // Sky blue glass
  divider: '#E0E0E0', // Light gray dividers
} as const

export function VoxelWindow({
  position,
  rotation,
  isSelected,
  isEditorMode,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: VoxelWindowProps) {
  const groupRef = useRef<THREE.Group>(null)

  const windowWidth = 1
  const windowHeight = 1
  const windowDepth = 0.1
  const frameThickness = 0.06
  const dividerThickness = 0.03

  return (
    <group
      ref={groupRef}
      position={[position.x + 0.5, position.y + 0.5, position.z + 0.5]}
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
      {/* Frame - Left */}
      <mesh
        position={[-windowWidth / 2 + frameThickness / 2, 0, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[frameThickness, windowHeight, windowDepth]} />
        <meshStandardMaterial color={WINDOW_COLORS.frame} roughness={0.5} metalness={0} />
      </mesh>

      {/* Frame - Right */}
      <mesh
        position={[windowWidth / 2 - frameThickness / 2, 0, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[frameThickness, windowHeight, windowDepth]} />
        <meshStandardMaterial color={WINDOW_COLORS.frame} roughness={0.5} metalness={0} />
      </mesh>

      {/* Frame - Top */}
      <mesh
        position={[0, windowHeight / 2 - frameThickness / 2, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[windowWidth, frameThickness, windowDepth]} />
        <meshStandardMaterial color={WINDOW_COLORS.frame} roughness={0.5} metalness={0} />
      </mesh>

      {/* Frame - Bottom */}
      <mesh
        position={[0, -windowHeight / 2 + frameThickness / 2, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[windowWidth, frameThickness, windowDepth]} />
        <meshStandardMaterial color={WINDOW_COLORS.frame} roughness={0.5} metalness={0} />
      </mesh>

      {/* Glass Pane */}
      <mesh position={[0, 0, 0]} receiveShadow>
        <boxGeometry
          args={[
            windowWidth - frameThickness * 2,
            windowHeight - frameThickness * 2,
            windowDepth / 2,
          ]}
        />
        <meshStandardMaterial
          color={WINDOW_COLORS.glass}
          transparent
          opacity={0.3}
          roughness={0.1}
          metalness={0.1}
        />
      </mesh>

      {/* Divider - Vertical Center */}
      <mesh position={[0, 0, windowDepth / 4]} castShadow>
        <boxGeometry
          args={[dividerThickness, windowHeight - frameThickness * 2, windowDepth / 2]}
        />
        <meshStandardMaterial color={WINDOW_COLORS.divider} roughness={0.5} metalness={0} />
      </mesh>

      {/* Divider - Horizontal Center */}
      <mesh position={[0, 0, windowDepth / 4]} castShadow>
        <boxGeometry
          args={[windowWidth - frameThickness * 2, dividerThickness, windowDepth / 2]}
        />
        <meshStandardMaterial color={WINDOW_COLORS.divider} roughness={0.5} metalness={0} />
      </mesh>

      {/* Selection highlight */}
      {isSelected && isEditorMode && (
        <mesh position={[0, 0, 0]}>
          <boxGeometry
            args={[windowWidth + 0.1, windowHeight + 0.1, windowDepth + 0.1]}
          />
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

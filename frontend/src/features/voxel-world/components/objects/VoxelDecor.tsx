import { useRef } from 'react'
import * as THREE from 'three'
import { VOXEL_COLORS, type VoxelPosition, type VoxelRotation } from '../../types/voxel'

interface VoxelDecorProps {
  position: VoxelPosition
  rotation: VoxelRotation
  isSelected: boolean
  isEditorMode: boolean
  onClick?: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

export function VoxelDecor({
  position,
  rotation,
  isSelected,
  isEditorMode,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: VoxelDecorProps) {
  const groupRef = useRef<THREE.Group>(null)

  const potRadius = 0.25
  const potHeight = 0.3
  const plantHeight = 1.2

  return (
    <group
      ref={groupRef}
      position={[position.x + 0.5, position.y, position.z + 0.5]}
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
      {/* Pot */}
      <mesh position={[0, potHeight / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[potRadius, potRadius * 0.8, potHeight, 16]} />
        <meshStandardMaterial
          color="#8B4513"
          roughness={0.9}
          metalness={0}
        />
      </mesh>

      {/* Soil */}
      <mesh position={[0, potHeight - 0.02, 0]} receiveShadow>
        <cylinderGeometry args={[potRadius - 0.02, potRadius - 0.02, 0.04, 16]} />
        <meshStandardMaterial
          color="#3D2914"
          roughness={1}
          metalness={0}
        />
      </mesh>

      {/* Plant trunk */}
      <mesh position={[0, potHeight + plantHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.08, plantHeight, 8]} />
        <meshStandardMaterial
          color="#4A3728"
          roughness={0.9}
          metalness={0}
        />
      </mesh>

      {/* Foliage layers */}
      {[0.4, 0.7, 1.0].map((h, i) => {
        const scale = 1 - i * 0.2
        return (
          <mesh
            key={i}
            position={[0, potHeight + h, 0]}
            castShadow
          >
            <coneGeometry args={[0.3 * scale, 0.4, 8]} />
            <meshStandardMaterial
              color="#228B22"
              roughness={0.8}
              metalness={0}
            />
          </mesh>
        )
      })}

      {/* Top cone */}
      <mesh position={[0, potHeight + plantHeight - 0.1, 0]} castShadow>
        <coneGeometry args={[0.15, 0.3, 8]} />
        <meshStandardMaterial
          color="#228B22"
          roughness={0.8}
          metalness={0}
        />
      </mesh>

      {/* Selection highlight */}
      {isSelected && isEditorMode && (
        <mesh position={[0, (potHeight + plantHeight) / 2, 0]}>
          <cylinderGeometry args={[0.4, 0.4, potHeight + plantHeight + 0.1, 16]} />
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

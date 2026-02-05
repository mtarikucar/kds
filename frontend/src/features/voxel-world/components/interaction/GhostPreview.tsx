import type { VoxelObject } from '../../types/voxel'

interface GhostPreviewProps {
  object: VoxelObject
  opacity?: number
  color?: string
}

export function GhostPreview({
  object,
  opacity = 0.5,
  color = '#3B82F6',
}: GhostPreviewProps) {
  const width = (object.metadata?.width as number) ?? 1
  const depth = (object.metadata?.depth as number) ?? 1
  const height = (object.metadata?.height as number) ?? 1

  return (
    <group position={[object.position.x, object.position.y, object.position.z]}>
      {/* Ghost mesh */}
      <mesh position={[width / 2, height / 2, depth / 2]}>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial
          color={color}
          transparent
          opacity={opacity}
          depthWrite={false}
        />
      </mesh>

      {/* Outline wireframe */}
      <mesh position={[width / 2, height / 2, depth / 2]}>
        <boxGeometry args={[width, height, depth]} />
        <meshBasicMaterial
          color={color}
          wireframe
          transparent
          opacity={opacity * 1.5}
        />
      </mesh>

      {/* Size label */}
      <group position={[width / 2, height + 0.3, depth / 2]}>
        {/* This would use @react-three/drei Text, but we'll keep it simple */}
      </group>
    </group>
  )
}

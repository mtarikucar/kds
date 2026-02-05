import type { WallVisibility } from '../types/voxel'

interface VoxelWallsProps {
  width: number
  height: number
  depth: number
  wallColor: string
  visibility?: WallVisibility
}

const DEFAULT_VISIBILITY: WallVisibility = {
  back: true,
  right: true,
  front: false,
  left: false,
}

export function VoxelWalls({
  width,
  height,
  depth,
  wallColor,
  visibility = DEFAULT_VISIBILITY,
}: VoxelWallsProps) {
  const wallThickness = 0.3

  return (
    <group>
      {/* Back wall (Z = 0) */}
      {visibility.back && (
        <mesh
          position={[width / 2, height / 2, wallThickness / 2]}
          receiveShadow
          castShadow
        >
          <boxGeometry args={[width + wallThickness * 2, height, wallThickness]} />
          <meshStandardMaterial
            color={wallColor}
            roughness={0.3}
            metalness={0}
          />
        </mesh>
      )}

      {/* Right wall (X = width) */}
      {visibility.right && (
        <mesh
          position={[width - wallThickness / 2, height / 2, depth / 2]}
          receiveShadow
          castShadow
        >
          <boxGeometry args={[wallThickness, height, depth]} />
          <meshStandardMaterial
            color={wallColor}
            roughness={0.3}
            metalness={0}
          />
        </mesh>
      )}

      {/* Front wall (Z = depth) */}
      {visibility.front && (
        <mesh
          position={[width / 2, height / 2, depth - wallThickness / 2]}
          receiveShadow
          castShadow
        >
          <boxGeometry args={[width + wallThickness * 2, height, wallThickness]} />
          <meshStandardMaterial
            color={wallColor}
            roughness={0.3}
            metalness={0}
          />
        </mesh>
      )}

      {/* Left wall (X = 0) */}
      {visibility.left && (
        <mesh
          position={[wallThickness / 2, height / 2, depth / 2]}
          receiveShadow
          castShadow
        >
          <boxGeometry args={[wallThickness, height, depth]} />
          <meshStandardMaterial
            color={wallColor}
            roughness={0.3}
            metalness={0}
          />
        </mesh>
      )}
    </group>
  )
}

interface VoxelWallsProps {
  width: number
  height: number
  depth: number
  wallColor: string
}

export function VoxelWalls({ width, height, depth, wallColor }: VoxelWallsProps) {
  const wallThickness = 0.3

  return (
    <group>
      {/* Back wall (Z = 0) */}
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

      {/* Right wall (X = width) */}
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
    </group>
  )
}

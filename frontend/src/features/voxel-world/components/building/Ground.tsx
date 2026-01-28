interface GroundProps {
  size?: number
}

export function Ground({ size = 100 }: GroundProps) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.01, 0]}
      receiveShadow
    >
      <planeGeometry args={[size, size]} />
      <meshStandardMaterial
        color="#f5f5f5"
        roughness={0.3}
        metalness={0}
      />
    </mesh>
  )
}

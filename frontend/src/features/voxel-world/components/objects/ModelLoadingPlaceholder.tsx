import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { VoxelPosition } from '../../types/voxel'

interface ModelLoadingPlaceholderProps {
  position: VoxelPosition
  size?: number
}

export function ModelLoadingPlaceholder({ position, size = 1 }: ModelLoadingPlaceholderProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const ringRef = useRef<THREE.Mesh>(null)

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 2
    }
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * 1.5
    }
  })

  return (
    <group position={[position.x, position.y + size / 2, position.z]}>
      <mesh ref={meshRef}>
        <boxGeometry args={[size * 0.5, size * 0.5, size * 0.5]} />
        <meshStandardMaterial
          color="#4a90d9"
          transparent
          opacity={0.6}
          wireframe
        />
      </mesh>

      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[size * 0.4, 0.02, 8, 32]} />
        <meshStandardMaterial
          color="#60a5fa"
          emissive="#60a5fa"
          emissiveIntensity={0.5}
        />
      </mesh>

      <pointLight
        color="#60a5fa"
        intensity={0.5}
        distance={size * 2}
      />
    </group>
  )
}

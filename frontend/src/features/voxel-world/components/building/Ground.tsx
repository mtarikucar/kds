import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Mesh } from 'three'
import * as THREE from 'three'

interface GroundProps {
  size?: number
}

export function Ground({ size = 50 }: GroundProps) {
  const meshRef = useRef<Mesh>(null)

  // Create a simple stone path texture pattern
  const groundColor = '#4a5568' // Stone gray
  const pathColor = '#718096' // Lighter stone

  return (
    <group>
      {/* Main ground plane */}
      <mesh
        ref={meshRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.01, 0]}
        receiveShadow
      >
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial
          color={groundColor}
          roughness={0.9}
          metalness={0.1}
        />
      </mesh>

      {/* Stone path leading to building */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 8]}
        receiveShadow
      >
        <planeGeometry args={[4, 16]} />
        <meshStandardMaterial
          color={pathColor}
          roughness={0.8}
          metalness={0.05}
        />
      </mesh>

      {/* Decorative stone tiles near entrance */}
      {[-1.5, 0, 1.5].map((x, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[x, 0.005, 12]}
          receiveShadow
        >
          <planeGeometry args={[1, 1]} />
          <meshStandardMaterial
            color="#9ca3af"
            roughness={0.7}
            metalness={0.1}
          />
        </mesh>
      ))}

      {/* Small decorative elements - grass patches */}
      {[
        [-8, -5],
        [8, -5],
        [-8, 10],
        [8, 10],
        [-12, 0],
        [12, 0],
      ].map(([x, z], i) => (
        <mesh
          key={`grass-${i}`}
          rotation={[-Math.PI / 2, 0, Math.random() * Math.PI]}
          position={[x, 0.01, z]}
          receiveShadow
        >
          <circleGeometry args={[2 + Math.random(), 8]} />
          <meshStandardMaterial
            color="#2d5016"
            roughness={1}
            metalness={0}
          />
        </mesh>
      ))}

      {/* Ambient ground fog effect - using a larger subtle plane */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.02, 0]}
      >
        <planeGeometry args={[size * 2, size * 2]} />
        <meshBasicMaterial
          color="#1a1a2e"
          transparent
          opacity={0.3}
        />
      </mesh>
    </group>
  )
}

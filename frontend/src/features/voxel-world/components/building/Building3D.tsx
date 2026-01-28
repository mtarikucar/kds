import { useRef, useState, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import type { Group, Mesh } from 'three'
import * as THREE from 'three'

const MODEL_PATH = `${import.meta.env.BASE_URL}models/building/japanic_restaurant.glb`

interface Building3DProps {
  position: [number, number, number]
  scale?: number
  isClickable?: boolean
  onClick?: () => void
}

export function Building3D({
  position,
  scale = 1,
  isClickable = false,
  onClick,
}: Building3DProps) {
  const groupRef = useRef<Group>(null)
  const [isHovered, setIsHovered] = useState(false)
  const emissiveIntensityRef = useRef(0)

  const { scene } = useGLTF(MODEL_PATH)

  // Clone the scene to avoid sharing state
  const clonedScene = scene.clone()

  // Enable shadows and setup materials
  useEffect(() => {
    clonedScene.traverse((child) => {
      if ('isMesh' in child && child.isMesh) {
        const mesh = child as Mesh
        mesh.castShadow = true
        mesh.receiveShadow = true

        // Clone material to allow individual modifications
        if (mesh.material) {
          mesh.material = (mesh.material as THREE.Material).clone()
        }
      }
    })
  }, [clonedScene])

  // Handle click
  const handleClick = () => {
    if (isClickable && onClick) {
      onClick()
    }
  }

  // Animation for hover glow effect
  useFrame((state, delta) => {
    if (!groupRef.current) return

    // Smooth transition for emissive intensity
    const targetIntensity = isHovered ? 0.3 : 0
    emissiveIntensityRef.current +=
      (targetIntensity - emissiveIntensityRef.current) * delta * 5

    // Apply emissive to all meshes when hovered
    clonedScene.traverse((child) => {
      if ('isMesh' in child && child.isMesh) {
        const mesh = child as Mesh
        const material = mesh.material as THREE.MeshStandardMaterial
        if (material.emissive) {
          material.emissiveIntensity = emissiveIntensityRef.current
          material.emissive.setHex(0xffd700) // Gold glow
        }
      }
    })

    // Subtle scale pulse on hover
    if (isHovered) {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.01
      groupRef.current.scale.setScalar(scale * pulse)
    } else {
      const currentScale = groupRef.current.scale.x
      const newScale = currentScale + (scale - currentScale) * 0.1
      groupRef.current.scale.setScalar(newScale)
    }
  })

  return (
    <group
      ref={groupRef}
      position={position}
      scale={scale}
      onClick={handleClick}
      onPointerEnter={() => isClickable && setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
    >
      <primitive object={clonedScene} />

      {/* Click indicator light when hovered */}
      {isClickable && isHovered && (
        <pointLight
          position={[0, 5, 0]}
          color="#ffd700"
          intensity={2}
          distance={10}
        />
      )}
    </group>
  )
}

// Preload the model
useGLTF.preload(MODEL_PATH)

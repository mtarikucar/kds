import { useRef, useState, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { Group } from 'three'
import type { MascotAnimation } from '../../types/voxel'

const MODEL_PATH = `${import.meta.env.BASE_URL}models/mascot/chef.glb`

interface Mascot3DProps {
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: number
  animation: MascotAnimation
  isClickable?: boolean
  onClick?: () => void
}

export function Mascot3D({
  position,
  rotation = [0, 0, 0],
  scale = 1,
  animation,
  isClickable = false,
  onClick,
}: Mascot3DProps) {
  const groupRef = useRef<Group>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [bounceTime, setBounceTime] = useState(0)

  const { scene } = useGLTF(MODEL_PATH)

  // Clone the scene and calculate Y offset to sit on ground
  const { clonedScene, yOffset } = useMemo(() => {
    const cloned = scene.clone()

    // Calculate bounding box to find the bottom of the model
    const box = new THREE.Box3().setFromObject(cloned)
    const offset = -box.min.y // Offset to bring bottom to y=0

    return { clonedScene: cloned, yOffset: offset }
  }, [scene])

  // Base Y position including offset for animations
  const baseY = position[1] + yOffset * scale

  // Enable shadows on all meshes
  useEffect(() => {
    clonedScene.traverse((child) => {
      if ('isMesh' in child && child.isMesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })
  }, [clonedScene])

  // Handle click with bounce animation
  const handleClick = () => {
    if (isClickable && onClick) {
      setBounceTime(0.5) // Start bounce animation
      onClick()
    }
  }

  // Animation loop
  useFrame((state, delta) => {
    if (!groupRef.current) return

    const time = state.clock.elapsedTime

    // Apply different animations based on type
    switch (animation) {
      case 'idle':
        // Gentle floating effect
        groupRef.current.position.y = baseY + Math.sin(time * 2) * 0.1
        // Subtle rotation
        groupRef.current.rotation.y = rotation[1] + Math.sin(time * 0.5) * 0.05
        break

      case 'bounce':
        // Energetic bouncing
        groupRef.current.position.y = baseY + Math.abs(Math.sin(time * 6)) * 0.3
        break

      case 'nod':
        // Head nodding (rotate around X axis)
        groupRef.current.rotation.x = Math.sin(time * 4) * 0.1
        groupRef.current.position.y = baseY + Math.sin(time * 2) * 0.05
        break
    }

    // Handle click bounce effect
    if (bounceTime > 0) {
      const bounce = Math.sin(bounceTime * Math.PI * 4) * bounceTime * 0.3
      groupRef.current.position.y = baseY + bounce
      setBounceTime(Math.max(0, bounceTime - delta))
    }

    // Hover scale effect
    const targetScale = isHovered ? scale * 1.1 : scale
    const currentScale = groupRef.current.scale.x
    const newScale = currentScale + (targetScale - currentScale) * 0.1
    groupRef.current.scale.setScalar(newScale)
  })

  // Calculate final position with Y offset for ground placement
  const finalPosition: [number, number, number] = [
    position[0],
    baseY,
    position[2],
  ]

  return (
    <group
      ref={groupRef}
      position={finalPosition}
      rotation={rotation}
      scale={scale}
      onClick={handleClick}
      onPointerEnter={() => isClickable && setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
    >
      <primitive object={clonedScene} />

      {/* Clickable indicator - subtle glow when hoverable */}
      {isClickable && isHovered && (
        <pointLight
          position={[0, 1, 0]}
          color="#ffd700"
          intensity={0.5}
          distance={3}
        />
      )}
    </group>
  )
}

// Preload the model
useGLTF.preload(MODEL_PATH)

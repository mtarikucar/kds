import { useMemo } from 'react'
import * as THREE from 'three'

interface VoxelWallsProps {
  width: number
  height: number
  depth: number
  wallColor: string
}

export function VoxelWalls({ width, height, depth, wallColor }: VoxelWallsProps) {
  const wallTexture = useMemo(() => {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!

    // Base brick color
    ctx.fillStyle = wallColor
    ctx.fillRect(0, 0, size, size)

    // Draw brick pattern
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'
    const brickHeight = size / 4
    const brickWidth = size / 2

    for (let row = 0; row < 4; row++) {
      const offset = row % 2 === 0 ? 0 : brickWidth / 2
      for (let col = -1; col < 3; col++) {
        const x = offset + col * brickWidth
        const y = row * brickHeight

        // Brick outline
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)'
        ctx.lineWidth = 2
        ctx.strokeRect(x + 1, y + 1, brickWidth - 2, brickHeight - 2)
      }
    }

    // Add noise
    const imageData = ctx.getImageData(0, 0, size, size)
    for (let i = 0; i < imageData.data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 15
      imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + noise))
      imageData.data[i + 1] = Math.max(0, Math.min(255, imageData.data[i + 1] + noise))
      imageData.data[i + 2] = Math.max(0, Math.min(255, imageData.data[i + 2] + noise))
    }
    ctx.putImageData(imageData, 0, 0)

    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    return tex
  }, [wallColor])

  const wallThickness = 0.5

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
          map={wallTexture.clone().tap((t) => {
            t.repeat.set(width / 2, height / 2)
          })}
          roughness={0.9}
          metalness={0}
        />
      </mesh>

      {/* Left wall (X = 0) */}
      <mesh
        position={[wallThickness / 2, height / 2, depth / 2]}
        receiveShadow
        castShadow
      >
        <boxGeometry args={[wallThickness, height, depth]} />
        <meshStandardMaterial
          map={wallTexture.clone().tap((t) => {
            t.repeat.set(depth / 2, height / 2)
          })}
          roughness={0.9}
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
          map={wallTexture.clone().tap((t) => {
            t.repeat.set(depth / 2, height / 2)
          })}
          roughness={0.9}
          metalness={0}
        />
      </mesh>
    </group>
  )
}

// Extend Three.js Texture prototype
declare module 'three' {
  interface Texture {
    tap(fn: (tex: Texture) => void): Texture
  }
}

THREE.Texture.prototype.tap = function(fn: (tex: THREE.Texture) => void): THREE.Texture {
  fn(this)
  return this
}

import { useMemo } from 'react'
import * as THREE from 'three'

interface VoxelFloorProps {
  width: number
  depth: number
  color: string
}

export function VoxelFloor({ width, depth, color }: VoxelFloorProps) {
  const texture = useMemo(() => {
    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!

    // Base color
    ctx.fillStyle = color
    ctx.fillRect(0, 0, size, size)

    // Add subtle grid pattern
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)'
    ctx.lineWidth = 1
    ctx.strokeRect(0, 0, size, size)

    // Add some noise/texture
    const imageData = ctx.getImageData(0, 0, size, size)
    for (let i = 0; i < imageData.data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 20
      imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + noise))
      imageData.data[i + 1] = Math.max(0, Math.min(255, imageData.data[i + 1] + noise))
      imageData.data[i + 2] = Math.max(0, Math.min(255, imageData.data[i + 2] + noise))
    }
    ctx.putImageData(imageData, 0, 0)

    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(width, depth)
    return tex
  }, [width, depth, color])

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[width / 2, 0, depth / 2]}
      receiveShadow
    >
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial
        map={texture}
        roughness={0.8}
        metalness={0.1}
      />
    </mesh>
  )
}

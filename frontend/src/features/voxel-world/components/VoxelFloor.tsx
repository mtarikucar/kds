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

    // Base color - light wood
    ctx.fillStyle = color
    ctx.fillRect(0, 0, size, size)

    // Subtle wood plank lines
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)'
    ctx.lineWidth = 1

    // Horizontal plank lines
    for (let y = 0; y < size; y += 16) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(size, y)
      ctx.stroke()
    }

    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(width / 2, depth / 2)
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
        roughness={0.4}
        metalness={0}
      />
    </mesh>
  )
}

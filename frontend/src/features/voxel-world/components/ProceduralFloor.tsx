/**
 * ProceduralFloor Component
 *
 * Renders floor tiles based on active floor cells with height support.
 * Each cell can have multiple levels (Townscaper-style stacking).
 */

import { useMemo } from 'react'
import * as THREE from 'three'
import { useVoxelStore } from '../store/voxelStore'
import { computeFloorTiles, type FloorTile } from '../utils/procedural/floorCellManager'

interface ProceduralFloorProps {
  color?: string
  tileHeight?: number
  levelHeight?: number // Height per level
}

// Shared geometry for performance
const TILE_GEOMETRY = new THREE.BoxGeometry(0.98, 0.1, 0.98)

// Color palette for different levels (Townscaper-inspired)
const LEVEL_COLORS = [
  '#e8dcc8', // Level 1 - light wood (ground)
  '#dcd0bc', // Level 2 - slightly darker
  '#d0c4b0', // Level 3
  '#c4b8a4', // Level 4
  '#b8ac98', // Level 5
  '#aca08c', // Level 6
  '#a09480', // Level 7
  '#948874', // Level 8
  '#887c68', // Level 9
  '#7c705c', // Level 10
]

export function ProceduralFloor({
  color = '#e8dcc8',
  tileHeight = 0.1,
  levelHeight = 1, // Each level is 1 unit tall
}: ProceduralFloorProps) {
  const floorCells = useVoxelStore((state) => state.floorCells)

  // Compute floor tiles from active cells (includes all levels)
  const tiles = useMemo(() => {
    return computeFloorTiles(floorCells)
  }, [floorCells])

  // Create texture for wood effect
  const createTexture = useMemo(() => {
    return (tileColor: string) => {
      const size = 64
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')!

      // Base color
      ctx.fillStyle = tileColor
      ctx.fillRect(0, 0, size, size)

      // Subtle wood plank lines
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)'
      ctx.lineWidth = 1

      // Horizontal plank lines
      for (let y = 0; y < size; y += 16) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(size, y)
        ctx.stroke()
      }

      // Add slight noise for texture
      ctx.fillStyle = 'rgba(0, 0, 0, 0.02)'
      for (let i = 0; i < 100; i++) {
        const x = Math.random() * size
        const y = Math.random() * size
        ctx.fillRect(x, y, 1, 1)
      }

      const tex = new THREE.CanvasTexture(canvas)
      tex.wrapS = THREE.RepeatWrapping
      tex.wrapT = THREE.RepeatWrapping
      return tex
    }
  }, [])

  // Create materials for each level
  const materials = useMemo(() => {
    return LEVEL_COLORS.map((levelColor) => {
      const texture = createTexture(levelColor)
      return new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.4,
        metalness: 0,
      })
    })
  }, [createTexture])

  // If no tiles, show empty state
  if (tiles.length === 0) {
    return <EmptyFloorIndicator />
  }

  return (
    <group>
      {tiles.map((tile) => (
        <FloorTileMesh
          key={`floor-${tile.x}-${tile.y}-${tile.z}`}
          tile={tile}
          materials={materials}
          tileHeight={tileHeight}
          levelHeight={levelHeight}
        />
      ))}
    </group>
  )
}

interface FloorTileMeshProps {
  tile: FloorTile
  materials: THREE.Material[]
  tileHeight: number
  levelHeight: number
}

function FloorTileMesh({ tile, materials, tileHeight, levelHeight }: FloorTileMeshProps) {
  // Get material for this level (cycle through colors if exceeded)
  const materialIndex = Math.min(tile.y, materials.length - 1)
  const material = materials[materialIndex]

  // Position tile at center of cell, stacked by level
  const yPosition = tile.y * levelHeight + tileHeight / 2

  const position: [number, number, number] = [
    tile.x + 0.5,
    yPosition,
    tile.z + 0.5,
  ]

  return (
    <mesh
      position={position}
      geometry={TILE_GEOMETRY}
      material={material}
      receiveShadow
      castShadow
    />
  )
}

/**
 * Empty floor indicator shown when no tiles are placed
 */
function EmptyFloorIndicator() {
  return (
    <group position={[32, 0.01, 32]}>
      {/* Center marker */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.8, 1, 32]} />
        <meshBasicMaterial
          color="#94a3b8"
          transparent
          opacity={0.3}
        />
      </mesh>

      {/* Cross indicator */}
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <mesh position={[0, 0, 0.001]}>
          <planeGeometry args={[0.1, 2]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0.3} />
        </mesh>
        <mesh position={[0, 0, 0.001]} rotation={[0, 0, Math.PI / 2]}>
          <planeGeometry args={[0.1, 2]} />
          <meshBasicMaterial color="#94a3b8" transparent opacity={0.3} />
        </mesh>
      </group>
    </group>
  )
}

export default ProceduralFloor

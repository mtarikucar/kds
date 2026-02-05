/**
 * ProceduralWalls Component
 *
 * Automatically generates and renders walls at floor cell edges.
 * Walls appear wherever floor cells border empty space.
 * Supports multi-level buildings with walls per level.
 */

import { useMemo, useCallback } from 'react'
import * as THREE from 'three'
import { type ThreeEvent } from '@react-three/fiber'
import { useVoxelStore } from '../store/voxelStore'
import {
  generateWalls,
  type WallSegment,
  type WallCorner,
} from '../utils/procedural/wallGenerator'
import {
  canPlaceStair,
  hasStairAtEdge,
} from '../utils/procedural/stairGenerator'
import type { StairSide } from '../types/voxel'

interface ProceduralWallsProps {
  wallColor?: string
  wallHeight?: number // Height per level
  wallThickness?: number
}

// Wall height per level
const LEVEL_HEIGHT = 1

// Color palette for walls at different levels
const WALL_COLORS = [
  '#f5f5f5', // Level 1 - white
  '#eeeeee', // Level 2
  '#e7e7e7', // Level 3
  '#e0e0e0', // Level 4
  '#d9d9d9', // Level 5
  '#d2d2d2', // Level 6
  '#cbcbcb', // Level 7
  '#c4c4c4', // Level 8
  '#bdbdbd', // Level 9
  '#b6b6b6', // Level 10
]

export function ProceduralWalls({
  wallColor = '#f5f5f5',
  wallHeight = LEVEL_HEIGHT,
  wallThickness = 0.15,
}: ProceduralWallsProps) {
  const floorCells = useVoxelStore((state) => state.floorCells)
  const stairs = useVoxelStore((state) => state.stairs)
  const decrementFloorHeight = useVoxelStore((state) => state.decrementFloorHeight)
  const toggleStair = useVoxelStore((state) => state.toggleStair)
  const editorTool = useVoxelStore((state) => state.editorTool)
  const isEditorMode = useVoxelStore((state) => state.isEditorMode)

  // Generate walls from floor cells, filtering out where stairs exist
  const walls = useMemo(() => {
    const generatedWalls = generateWalls(floorCells)

    // Filter out wall segments where stairs are placed
    const filteredSegments = generatedWalls.segments.filter((segment) => {
      // Determine which cell edge this wall segment represents
      if (segment.direction === 'horizontal') {
        // Horizontal wall at z position
        const cellX = Math.floor((segment.startX + segment.endX) / 2)
        // Wall could be on north edge of cell at z, or south edge of cell at z-1
        const southCellZ = segment.startZ
        const northCellZ = segment.startZ - 1

        // Check both possible cells for this edge
        const southHeight = floorCells.get(`${cellX},${southCellZ}`) ?? 0
        const northHeight = floorCells.get(`${cellX},${northCellZ}`) ?? 0

        // Stair would be at the lower level, connecting to the level above
        const stairLevel = Math.min(southHeight, northHeight)
        if (stairLevel > 0 && Math.abs(southHeight - northHeight) === 1) {
          // Determine which cell has the stair
          if (southHeight < northHeight) {
            // Stair on south cell facing north
            if (hasStairAtEdge(stairs, cellX, southCellZ, stairLevel, 'n')) {
              return segment.level !== stairLevel + 1 // Hide wall where stair is
            }
          } else {
            // Stair on north cell facing south
            if (hasStairAtEdge(stairs, cellX, northCellZ, stairLevel, 's')) {
              return segment.level !== stairLevel + 1
            }
          }
        }
      } else {
        // Vertical wall at x position
        const cellZ = Math.floor((segment.startZ + segment.endZ) / 2)
        const eastCellX = segment.startX
        const westCellX = segment.startX - 1

        const eastHeight = floorCells.get(`${eastCellX},${cellZ}`) ?? 0
        const westHeight = floorCells.get(`${westCellX},${cellZ}`) ?? 0

        const stairLevel = Math.min(eastHeight, westHeight)
        if (stairLevel > 0 && Math.abs(eastHeight - westHeight) === 1) {
          if (eastHeight < westHeight) {
            if (hasStairAtEdge(stairs, eastCellX, cellZ, stairLevel, 'w')) {
              return segment.level !== stairLevel + 1
            }
          } else {
            if (hasStairAtEdge(stairs, westCellX, cellZ, stairLevel, 'e')) {
              return segment.level !== stairLevel + 1
            }
          }
        }
      }

      return true
    })

    return {
      segments: filteredSegments,
      corners: generatedWalls.corners,
    }
  }, [floorCells, stairs])

  // Create wall materials for each level
  const materials = useMemo(() => {
    return WALL_COLORS.map((color) => {
      return new THREE.MeshStandardMaterial({
        color,
        roughness: 0.3,
        metalness: 0,
      })
    })
  }, [])

  // Handle wall click - toggle stair if height difference is 1, otherwise decrement floor
  const handleWallClick = useCallback(
    (segment: WallSegment, e: ThreeEvent<MouseEvent>) => {
      if (!isEditorMode || editorTool !== 'floor') return

      // Shift is for camera control, let it pass through
      if (e.nativeEvent.shiftKey) return

      e.stopPropagation()

      // Find the floor cells adjacent to this wall
      let cellX: number
      let cellZ: number
      let side: StairSide

      if (segment.direction === 'horizontal') {
        // Horizontal wall at z position
        cellX = Math.floor((segment.startX + segment.endX) / 2)
        const northCellZ = segment.startZ - 1
        const southCellZ = segment.startZ
        const northHeight = floorCells.get(`${cellX},${northCellZ}`) ?? 0
        const southHeight = floorCells.get(`${cellX},${southCellZ}`) ?? 0

        // Check if stair can be placed (exactly 1 level difference)
        if (Math.abs(northHeight - southHeight) === 1 && northHeight > 0 && southHeight > 0) {
          // Determine which cell is lower and place stair there
          if (southHeight < northHeight) {
            cellX = cellX
            cellZ = southCellZ
            side = 'n'
          } else {
            cellX = cellX
            cellZ = northCellZ
            side = 's'
          }
          const stairLevel = Math.min(northHeight, southHeight)
          toggleStair(cellX, cellZ, stairLevel, side)
          return
        }

        // No stair possible, decrement floor height as before
        if (northHeight >= segment.level) {
          cellZ = northCellZ
        } else if (southHeight >= segment.level) {
          cellZ = southCellZ
        } else {
          return
        }
      } else {
        // Vertical wall at x position
        cellZ = Math.floor((segment.startZ + segment.endZ) / 2)
        const westCellX = segment.startX - 1
        const eastCellX = segment.startX
        const westHeight = floorCells.get(`${westCellX},${cellZ}`) ?? 0
        const eastHeight = floorCells.get(`${eastCellX},${cellZ}`) ?? 0

        // Check if stair can be placed
        if (Math.abs(westHeight - eastHeight) === 1 && westHeight > 0 && eastHeight > 0) {
          if (eastHeight < westHeight) {
            cellX = eastCellX
            side = 'w'
          } else {
            cellX = westCellX
            side = 'e'
          }
          const stairLevel = Math.min(westHeight, eastHeight)
          toggleStair(cellX, cellZ, stairLevel, side)
          return
        }

        // No stair possible, decrement floor height as before
        if (westHeight >= segment.level) {
          cellX = westCellX
        } else if (eastHeight >= segment.level) {
          cellX = eastCellX
        } else {
          return
        }
      }

      decrementFloorHeight(cellX, cellZ)
    },
    [isEditorMode, editorTool, floorCells, decrementFloorHeight, toggleStair]
  )

  // Handle corner click
  const handleCornerClick = useCallback(
    (corner: WallCorner, e: ThreeEvent<MouseEvent>) => {
      if (!isEditorMode || editorTool !== 'floor') return

      // Shift is for camera control, let it pass through
      if (e.nativeEvent.shiftKey) return

      e.stopPropagation()

      // Find the floor cell at this corner
      // Check all 4 cells around the corner
      const candidates = [
        { x: corner.x - 1, z: corner.z - 1 }, // NW
        { x: corner.x, z: corner.z - 1 },     // NE
        { x: corner.x - 1, z: corner.z },     // SW
        { x: corner.x, z: corner.z },         // SE
      ]

      for (const { x, z } of candidates) {
        const height = floorCells.get(`${x},${z}`) ?? 0
        if (height >= corner.level) {
          decrementFloorHeight(x, z)
          return
        }
      }
    },
    [isEditorMode, editorTool, floorCells, decrementFloorHeight]
  )

  // If no floor cells, no walls to render
  if (floorCells.size === 0) {
    return null
  }

  const isClickable = isEditorMode && editorTool === 'floor'

  return (
    <group>
      {/* Wall segments */}
      {walls.segments.map((segment) => (
        <WallSegmentMesh
          key={segment.id}
          segment={segment}
          materials={materials}
          height={wallHeight}
          thickness={wallThickness}
          onClick={isClickable ? (e) => handleWallClick(segment, e) : undefined}
        />
      ))}

      {/* Corner pieces for smoother joins */}
      {walls.corners.map((corner, index) => (
        <WallCornerMesh
          key={`corner-${index}-${corner.level}`}
          corner={corner}
          materials={materials}
          height={wallHeight}
          thickness={wallThickness}
          onClick={isClickable ? (e) => handleCornerClick(corner, e) : undefined}
        />
      ))}
    </group>
  )
}

interface WallSegmentMeshProps {
  segment: WallSegment
  materials: THREE.Material[]
  height: number
  thickness: number
  onClick?: (e: ThreeEvent<MouseEvent>) => void
}

function WallSegmentMesh({
  segment,
  materials,
  height,
  thickness,
  onClick,
}: WallSegmentMeshProps) {
  // Get material for this level
  const materialIndex = Math.min(segment.level - 1, materials.length - 1)
  const material = materials[materialIndex]

  // Calculate wall dimensions based on direction
  const isHorizontal = segment.direction === 'horizontal'

  // Length of the wall
  const length = isHorizontal
    ? segment.endX - segment.startX
    : segment.endZ - segment.startZ

  // Create geometry for this segment
  const geometry = useMemo(() => {
    if (isHorizontal) {
      return new THREE.BoxGeometry(length, height, thickness)
    } else {
      return new THREE.BoxGeometry(thickness, height, length)
    }
  }, [isHorizontal, length, height, thickness])

  // Calculate Y position based on level
  const yPosition = (segment.level - 1) * LEVEL_HEIGHT + height / 2

  // Calculate center position
  const position: [number, number, number] = isHorizontal
    ? [
        (segment.startX + segment.endX) / 2,
        yPosition,
        segment.startZ,
      ]
    : [
        segment.startX,
        yPosition,
        (segment.startZ + segment.endZ) / 2,
      ]

  return (
    <mesh
      position={position}
      geometry={geometry}
      material={material}
      castShadow
      receiveShadow
      onClick={onClick}
    />
  )
}

interface WallCornerMeshProps {
  corner: WallCorner
  materials: THREE.Material[]
  height: number
  thickness: number
  onClick?: (e: ThreeEvent<MouseEvent>) => void
}

function WallCornerMesh({
  corner,
  materials,
  height,
  thickness,
  onClick,
}: WallCornerMeshProps) {
  // Get material for this level
  const materialIndex = Math.min(corner.level - 1, materials.length - 1)
  const material = materials[materialIndex]

  // Corner fill to cover gaps where walls meet
  const geometry = useMemo(() => {
    return new THREE.BoxGeometry(thickness, height, thickness)
  }, [thickness, height])

  // Calculate Y position based on level
  const yPosition = (corner.level - 1) * LEVEL_HEIGHT + height / 2

  return (
    <mesh
      position={[corner.x, yPosition, corner.z]}
      rotation={[0, THREE.MathUtils.degToRad(corner.rotation), 0]}
      geometry={geometry}
      material={material}
      castShadow
      receiveShadow
      onClick={onClick}
    />
  )
}

export default ProceduralWalls

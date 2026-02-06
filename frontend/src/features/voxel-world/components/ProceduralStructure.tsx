/**
 * ProceduralStructure Component
 *
 * Unified structural renderer that replaces ProceduralWalls + ProceduralRailings.
 * Uses the rule engine to classify edges, then renders via chunked instanced meshes.
 */

import { useMemo, useCallback } from 'react'
import * as THREE from 'three'
import { type ThreeEvent } from '@react-three/fiber'
import { useVoxelStore } from '../store/voxelStore'
import { useRuleEngine } from '../hooks/useRuleEngine'
import { useChunkRenderer } from '../hooks/useChunkRenderer'
import { ChunkedStructureRenderer } from './ChunkedStructureRenderer'
import type { CellEdge, CornerClassification, EdgeClassification } from '../types/worldModel'
import type { StairSide } from '../types/voxel'
import { canPlaceStair } from '../utils/procedural/stairGenerator'

interface ProceduralStructureProps {
  wallColor?: string
  wallHeight?: number
  wallThickness?: number
  railingColor?: string
}

const LEVEL_HEIGHT = 1

// Warm plaster tones — subtle variation per level
const WALL_COLORS = [
  '#f0e6d6', '#ebe1d1', '#e6dccc', '#e1d7c7', '#dcd2c2',
  '#d7cdbd', '#d2c8b8', '#cdc3b3', '#c8beae', '#c3b9a9',
]

const WINDOW_COLOR = '#a8d8ea'
const DOOR_COLOR = '#6b4423'

export function ProceduralStructure({
  wallColor = '#f5f5f5',
  wallHeight = LEVEL_HEIGHT,
  wallThickness = 0.15,
  railingColor = '#4a4a4a',
}: ProceduralStructureProps) {
  const floorCells = useVoxelStore((state) => state.floorCells)
  const stairs = useVoxelStore((state) => state.stairs)
  const overrides = useVoxelStore((state) => state.overrides)
  const rules = useVoxelStore((state) => state.rules)
  const decrementFloorHeight = useVoxelStore((state) => state.decrementFloorHeight)
  const toggleStair = useVoxelStore((state) => state.toggleStair)
  const editorTool = useVoxelStore((state) => state.editorTool)
  const isEditorMode = useVoxelStore((state) => state.isEditorMode)

  // Evaluate rule engine
  const structuralOutput = useRuleEngine(floorCells, stairs, overrides, { rules })

  // Split into chunks for rendering
  const chunks = useChunkRenderer(structuralOutput)

  // Create materials for walls at different levels — matte plaster look
  const wallMaterials = useMemo(() => {
    return WALL_COLORS.map((color) => {
      return new THREE.MeshStandardMaterial({
        color,
        roughness: 0.85,
        metalness: 0,
      })
    })
  }, [])

  // Material for railings — wrought iron style
  const railingMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: railingColor,
      roughness: 0.4,
      metalness: 0.6,
    })
  }, [railingColor])

  // Material for windows — subtle translucent glass
  const windowMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: WINDOW_COLOR,
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.35,
    })
  }, [])

  // Material for doors — warm wood
  const doorMaterial = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color: DOOR_COLOR,
      roughness: 0.7,
      metalness: 0,
    })
  }, [])

  // Handle edge click (wall interaction)
  const handleEdgeClick = useCallback(
    (edge: CellEdge, e: ThreeEvent<MouseEvent>) => {
      if (!isEditorMode || editorTool !== 'floor') return
      if (e.nativeEvent.shiftKey) return

      e.stopPropagation()

      const { x, z, level, side } = edge

      // Check if stair can be placed (height diff == 1)
      const neighborOffset = {
        n: { dx: 0, dz: -1 },
        s: { dx: 0, dz: 1 },
        e: { dx: 1, dz: 0 },
        w: { dx: -1, dz: 0 },
      }[side]

      const neighborKey = `${x + neighborOffset.dx},${z + neighborOffset.dz}`
      const cellHeight = floorCells.get(`${x},${z}`) ?? 0
      const neighborHeight = floorCells.get(neighborKey) ?? 0

      if (
        Math.abs(cellHeight - neighborHeight) === 1 &&
        cellHeight > 0 &&
        neighborHeight > 0
      ) {
        // Toggle stair
        if (cellHeight < neighborHeight) {
          toggleStair(x, z, cellHeight, side)
        } else {
          const oppositeSide = { n: 's', s: 'n', e: 'w', w: 'e' }[side] as StairSide
          toggleStair(
            x + neighborOffset.dx,
            z + neighborOffset.dz,
            neighborHeight,
            oppositeSide
          )
        }
        return
      }

      // Otherwise, decrement floor height
      if (cellHeight >= level) {
        decrementFloorHeight(x, z)
      }
    },
    [isEditorMode, editorTool, floorCells, decrementFloorHeight, toggleStair]
  )

  if (floorCells.size === 0) return null

  const isClickable = isEditorMode && editorTool === 'floor'

  return (
    <group>
      {chunks.map((chunk) => (
        <ChunkedStructureRenderer
          key={chunk.key}
          edges={chunk.edges}
          corners={chunk.corners}
          wallMaterials={wallMaterials}
          railingMaterial={railingMaterial}
          windowMaterial={windowMaterial}
          doorMaterial={doorMaterial}
          wallHeight={wallHeight}
          wallThickness={wallThickness}
          onEdgeClick={isClickable ? handleEdgeClick : undefined}
        />
      ))}
    </group>
  )
}

export default ProceduralStructure

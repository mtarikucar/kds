import { useCallback, useMemo } from 'react'
import { useVoxelStore } from '../store/voxelStore'
import { canPlaceStair, stairKey } from '../utils/procedural/stairGenerator'
import type { StairSide } from '../types/voxel'

interface StairPlacement {
  x: number
  z: number
  level: number
  side: StairSide
  canPlace: boolean
  hasStair: boolean
}

interface UseStairEditorOptions {
  enabled?: boolean
}

export function useStairEditor(options: UseStairEditorOptions = {}) {
  const { enabled = true } = options

  const floorCells = useVoxelStore((state) => state.floorCells)
  const stairs = useVoxelStore((state) => state.stairs)
  const addStair = useVoxelStore((state) => state.addStair)
  const removeStair = useVoxelStore((state) => state.removeStair)
  const pushHistory = useVoxelStore((state) => state.pushHistory)
  const editorTool = useVoxelStore((state) => state.editorTool)

  const isStairToolActive = editorTool === 'stair'

  /**
   * Handle click on a stair placement location
   * Left click: add stair
   * Right click: remove stair
   */
  const handleStairClick = useCallback(
    (
      x: number,
      z: number,
      level: number,
      side: StairSide,
      isRightClick: boolean = false
    ): boolean => {
      if (!enabled || !isStairToolActive) return false

      const key = stairKey(x, z, level, side)
      const hasExistingStair = stairs.has(key)

      if (isRightClick) {
        // Right click: remove stair if exists
        if (hasExistingStair) {
          removeStair(x, z, level, side)
          pushHistory()
          return true
        }
        return false
      }

      // Left click: toggle stair
      if (hasExistingStair) {
        removeStair(x, z, level, side)
        pushHistory()
        return true
      }

      // Check if we can place a stair here
      if (canPlaceStair(floorCells, x, z, side)) {
        addStair(x, z, level, side)
        pushHistory()
        return true
      }

      return false
    },
    [
      enabled,
      isStairToolActive,
      floorCells,
      stairs,
      addStair,
      removeStair,
      pushHistory,
    ]
  )

  /**
   * Get all valid stair placement locations for visual indicators
   * Returns locations where stairs can be placed (where there's 1 level height difference)
   */
  const getStairPlacements = useCallback((): StairPlacement[] => {
    if (!enabled || !isStairToolActive) return []

    const placements: StairPlacement[] = []
    const sides: StairSide[] = ['n', 's', 'e', 'w']

    // Iterate over all floor cells
    for (const [key, height] of floorCells.entries()) {
      const [xStr, zStr] = key.split(',')
      const x = parseInt(xStr, 10)
      const z = parseInt(zStr, 10)

      // Check each side for valid stair placement
      for (const side of sides) {
        // Check for each level where stairs can be placed
        for (let level = 0; level < height; level++) {
          const canPlace = canPlaceStair(floorCells, x, z, side)
          const hasStair = stairs.has(stairKey(x, z, level, side))

          // Only add placement if it's valid or already has a stair
          if (canPlace || hasStair) {
            placements.push({
              x,
              z,
              level,
              side,
              canPlace,
              hasStair,
            })
          }
        }
      }
    }

    return placements
  }, [enabled, isStairToolActive, floorCells, stairs])

  /**
   * Check if a specific location has a valid stair placement
   */
  const checkPlacement = useCallback(
    (x: number, z: number, side: StairSide): boolean => {
      return canPlaceStair(floorCells, x, z, side)
    },
    [floorCells]
  )

  /**
   * Check if a stair exists at a specific location
   */
  const hasStairAt = useCallback(
    (x: number, z: number, level: number, side: StairSide): boolean => {
      return stairs.has(stairKey(x, z, level, side))
    },
    [stairs]
  )

  return {
    isStairToolActive,
    handleStairClick,
    getStairPlacements,
    checkPlacement,
    hasStairAt,
    floorCells,
    stairs,
  }
}

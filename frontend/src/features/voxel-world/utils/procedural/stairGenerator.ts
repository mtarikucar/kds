/**
 * Stair Generator
 *
 * Handles stair placement validation and geometry computation.
 * Stairs connect two adjacent levels where there is exactly 1 level height difference.
 */

import type { StairSegment, StairSide } from '../../types/voxel'
import { cellKey } from './floorCellManager'

/**
 * Number of steps per level (floor height = 1 unit)
 */
export const STEPS_PER_LEVEL = 4

/**
 * Height of each step
 */
export const STEP_HEIGHT = 1 / STEPS_PER_LEVEL // 0.25 units

/**
 * Depth of each step (tread)
 */
export const STEP_DEPTH = 0.3

/**
 * Width of stairs (full cell width)
 */
export const STAIR_WIDTH = 1

/**
 * Stair color
 */
export const STAIR_COLOR = '#c4a882' // Light brown

/**
 * Get the neighbor position based on side
 */
export function getNeighborPosition(
  x: number,
  z: number,
  side: StairSide
): { x: number; z: number } {
  switch (side) {
    case 'n':
      return { x, z: z - 1 }
    case 's':
      return { x, z: z + 1 }
    case 'e':
      return { x: x + 1, z }
    case 'w':
      return { x: x - 1, z }
  }
}

/**
 * Check if a stair can be placed at the given position
 * Requires exactly 1 level height difference between adjacent cells
 */
export function canPlaceStair(
  floorCells: Map<string, number>,
  x: number,
  z: number,
  side: StairSide
): boolean {
  const currentHeight = floorCells.get(cellKey(x, z)) ?? 0
  if (currentHeight < 1) return false // Need at least 1 level

  const neighbor = getNeighborPosition(x, z, side)
  const neighborHeight = floorCells.get(cellKey(neighbor.x, neighbor.z)) ?? 0

  // Stair requires exactly 1 level difference
  const heightDiff = Math.abs(currentHeight - neighborHeight)
  return heightDiff === 1 && neighborHeight > 0
}

/**
 * Determine which cell is the lower level for the stair
 * Returns the cell coordinates and level of the lower floor
 */
export function getStairLowerCell(
  floorCells: Map<string, number>,
  x: number,
  z: number,
  side: StairSide
): { x: number; z: number; level: number } | null {
  const currentHeight = floorCells.get(cellKey(x, z)) ?? 0
  const neighbor = getNeighborPosition(x, z, side)
  const neighborHeight = floorCells.get(cellKey(neighbor.x, neighbor.z)) ?? 0

  if (currentHeight < neighborHeight) {
    return { x, z, level: currentHeight }
  } else if (neighborHeight < currentHeight) {
    return { x: neighbor.x, z: neighbor.z, level: neighborHeight }
  }
  return null
}

/**
 * Get rotation angle (in degrees) for stair based on direction
 * The stair faces the direction of ascent (lower to higher)
 */
export function getStairRotation(side: StairSide): number {
  switch (side) {
    case 'n':
      return 0 // Faces north (ascending northward)
    case 's':
      return 180
    case 'e':
      return 90
    case 'w':
      return 270
  }
}

/**
 * Interface for stair mesh geometry data
 */
export interface StairStepGeometry {
  position: [number, number, number]
  size: [number, number, number]
}

/**
 * Compute the geometry for all steps of a stair
 * Returns array of step positions and sizes
 */
export function computeStairGeometry(stair: StairSegment): StairStepGeometry[] {
  const steps: StairStepGeometry[] = []

  // Base position (center of the lower cell, at floor level)
  // Y position starts at the level's floor height
  const baseY = stair.level * 1 // Each level is 1 unit high

  for (let i = 0; i < stair.steps; i++) {
    // Each step is progressively higher and offset in the stair direction
    const stepY = baseY + (i + 0.5) * STEP_HEIGHT
    const offset = (i / stair.steps) * (1 - STEP_DEPTH) + STEP_DEPTH / 2

    let stepX: number
    let stepZ: number

    // Position step based on direction
    // Stair extends from cell center toward the neighbor
    switch (stair.side) {
      case 'n':
        stepX = stair.x + 0.5
        stepZ = stair.z - offset
        break
      case 's':
        stepX = stair.x + 0.5
        stepZ = stair.z + 1 + offset
        break
      case 'e':
        stepX = stair.x + 1 + offset
        stepZ = stair.z + 0.5
        break
      case 'w':
        stepX = stair.x - offset
        stepZ = stair.z + 0.5
        break
    }

    steps.push({
      position: [stepX, stepY, stepZ],
      size: [
        stair.side === 'n' || stair.side === 's' ? STAIR_WIDTH : STEP_DEPTH,
        STEP_HEIGHT,
        stair.side === 'e' || stair.side === 'w' ? STAIR_WIDTH : STEP_DEPTH,
      ],
    })
  }

  return steps
}

/**
 * Generate a unique key for a stair position
 */
export function stairKey(
  x: number,
  z: number,
  level: number,
  side: StairSide
): string {
  return `${x},${z},${level},${side}`
}

/**
 * Parse a stair key back to coordinates
 */
export function parseStairKey(key: string): {
  x: number
  z: number
  level: number
  side: StairSide
} {
  const [x, z, level, side] = key.split(',')
  return {
    x: parseInt(x, 10),
    z: parseInt(z, 10),
    level: parseInt(level, 10),
    side: side as StairSide,
  }
}

/**
 * Check if there's a stair at the given wall edge
 * Used by wall generator to skip walls where stairs exist
 */
export function hasStairAtEdge(
  stairs: Map<string, StairSegment>,
  x: number,
  z: number,
  level: number,
  side: StairSide
): boolean {
  // Check both possible stair positions for this edge
  // A stair at (x,z) facing 'n' also affects edge at (x,z-1) facing 's'
  const key1 = stairKey(x, z, level, side)
  if (stairs.has(key1)) return true

  // Check the opposite cell's perspective
  const neighbor = getNeighborPosition(x, z, side)
  const oppositeSide = getOppositeSide(side)
  const key2 = stairKey(neighbor.x, neighbor.z, level, oppositeSide)
  return stairs.has(key2)
}

/**
 * Get the opposite side direction
 */
export function getOppositeSide(side: StairSide): StairSide {
  switch (side) {
    case 'n':
      return 's'
    case 's':
      return 'n'
    case 'e':
      return 'w'
    case 'w':
      return 'e'
  }
}

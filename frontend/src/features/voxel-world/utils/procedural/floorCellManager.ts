/**
 * Floor Cell Manager
 *
 * Manages floor cells for Townscaper-style procedural layout.
 * Users click to add/remove floor cells, walls generate automatically.
 * Supports multi-level buildings (height per cell).
 */

export interface FloorCell {
  x: number
  z: number
  height: number // Number of levels (0 = no floor, 1+ = floor with height)
}

export interface FloorTile {
  x: number
  y: number // Level (0 = ground, 1 = first floor, etc.)
  z: number
  neighborMask: number
  variant: FloorTileVariant
}

export type FloorTileVariant =
  | 'center' // All neighbors present
  | 'edge-n'
  | 'edge-s'
  | 'edge-e'
  | 'edge-w'
  | 'corner-ne'
  | 'corner-nw'
  | 'corner-se'
  | 'corner-sw'
  | 'inner-corner-ne'
  | 'inner-corner-nw'
  | 'inner-corner-se'
  | 'inner-corner-sw'
  | 'peninsula-n'
  | 'peninsula-s'
  | 'peninsula-e'
  | 'peninsula-w'
  | 'isolated'

// Neighbor mask bits:
// N=1, NE=2, E=4, SE=8, S=16, SW=32, W=64, NW=128
export const NEIGHBOR_MASKS = {
  N: 1,
  NE: 2,
  E: 4,
  SE: 8,
  S: 16,
  SW: 32,
  W: 64,
  NW: 128,
} as const

/**
 * Generate a unique cell key from coordinates
 */
export function cellKey(x: number, z: number): string {
  return `${x},${z}`
}

/**
 * Parse cell key back to coordinates
 */
export function parseKey(key: string): { x: number; z: number } {
  const [x, z] = key.split(',').map(Number)
  return { x, z }
}

/**
 * Calculate 8-bit neighbor mask for a cell at a specific level
 * Bit positions: N=0, NE=1, E=2, SE=3, S=4, SW=5, W=6, NW=7
 * A neighbor is considered present if it has at least the same height level
 */
export function getNeighborMask(
  cells: Map<string, number>,
  x: number,
  z: number,
  level: number = 1
): number {
  let mask = 0

  const hasNeighborAtLevel = (nx: number, nz: number) => {
    const height = cells.get(cellKey(nx, nz)) ?? 0
    return height >= level
  }

  if (hasNeighborAtLevel(x, z - 1)) mask |= NEIGHBOR_MASKS.N
  if (hasNeighborAtLevel(x + 1, z - 1)) mask |= NEIGHBOR_MASKS.NE
  if (hasNeighborAtLevel(x + 1, z)) mask |= NEIGHBOR_MASKS.E
  if (hasNeighborAtLevel(x + 1, z + 1)) mask |= NEIGHBOR_MASKS.SE
  if (hasNeighborAtLevel(x, z + 1)) mask |= NEIGHBOR_MASKS.S
  if (hasNeighborAtLevel(x - 1, z + 1)) mask |= NEIGHBOR_MASKS.SW
  if (hasNeighborAtLevel(x - 1, z)) mask |= NEIGHBOR_MASKS.W
  if (hasNeighborAtLevel(x - 1, z - 1)) mask |= NEIGHBOR_MASKS.NW

  return mask
}

/**
 * Check if specific neighbors exist based on mask
 */
export function hasNeighbor(
  mask: number,
  direction: keyof typeof NEIGHBOR_MASKS
): boolean {
  return (mask & NEIGHBOR_MASKS[direction]) !== 0
}

/**
 * Determine tile variant from neighbor mask
 */
export function getTileVariant(mask: number): FloorTileVariant {
  const hasN = hasNeighbor(mask, 'N')
  const hasS = hasNeighbor(mask, 'S')
  const hasE = hasNeighbor(mask, 'E')
  const hasW = hasNeighbor(mask, 'W')
  const hasNE = hasNeighbor(mask, 'NE')
  const hasNW = hasNeighbor(mask, 'NW')
  const hasSE = hasNeighbor(mask, 'SE')
  const hasSW = hasNeighbor(mask, 'SW')

  // Count cardinal neighbors
  const cardinalCount = [hasN, hasS, hasE, hasW].filter(Boolean).length

  // Isolated (no cardinal neighbors)
  if (cardinalCount === 0) {
    return 'isolated'
  }

  // Peninsula (only one cardinal neighbor)
  if (cardinalCount === 1) {
    if (hasN) return 'peninsula-s'
    if (hasS) return 'peninsula-n'
    if (hasE) return 'peninsula-w'
    if (hasW) return 'peninsula-e'
  }

  // Outer corners (two adjacent cardinal neighbors)
  if (cardinalCount === 2) {
    if (hasN && hasE && !hasW && !hasS) return 'corner-sw'
    if (hasN && hasW && !hasE && !hasS) return 'corner-se'
    if (hasS && hasE && !hasW && !hasN) return 'corner-nw'
    if (hasS && hasW && !hasE && !hasN) return 'corner-ne'
  }

  // Check for inner corners (all cardinals but missing diagonal)
  if (hasN && hasS && hasE && hasW) {
    // All cardinals present, check for inner corners
    if (!hasNE) return 'inner-corner-ne'
    if (!hasNW) return 'inner-corner-nw'
    if (!hasSE) return 'inner-corner-se'
    if (!hasSW) return 'inner-corner-sw'
    // Fully surrounded
    return 'center'
  }

  // Edge tiles (three cardinal neighbors)
  if (cardinalCount === 3) {
    if (!hasN) return 'edge-n'
    if (!hasS) return 'edge-s'
    if (!hasE) return 'edge-e'
    if (!hasW) return 'edge-w'
  }

  // Default to center
  return 'center'
}

/**
 * Compute floor tiles from cells with height
 * Generates a tile for each level of each cell
 */
export function computeFloorTiles(cells: Map<string, number>): FloorTile[] {
  const tiles: FloorTile[] = []

  for (const [key, height] of cells) {
    if (height <= 0) continue

    const { x, z } = parseKey(key)

    // Generate a tile for each level
    for (let level = 1; level <= height; level++) {
      const neighborMask = getNeighborMask(cells, x, z, level)
      const variant = getTileVariant(neighborMask)

      tiles.push({
        x,
        y: level - 1, // 0-indexed for rendering (level 1 = y:0)
        z,
        neighborMask,
        variant,
      })
    }
  }

  return tiles
}

/**
 * Get bounding box of active cells
 */
export function getFloorBounds(cells: Map<string, number>): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  maxHeight: number
  width: number
  depth: number
} | null {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let maxHeight = 0

  for (const [key, height] of cells) {
    if (height <= 0) continue
    const { x, z } = parseKey(key)
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
    maxHeight = Math.max(maxHeight, height)
  }

  if (minX === Infinity) return null

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    maxHeight,
    width: maxX - minX + 1,
    depth: maxZ - minZ + 1,
  }
}

/**
 * Check if a position is on active floor
 */
export function isOnFloor(
  cells: Map<string, number>,
  x: number,
  z: number
): boolean {
  const gridX = Math.floor(x)
  const gridZ = Math.floor(z)
  const height = cells.get(cellKey(gridX, gridZ)) ?? 0
  return height > 0
}

/**
 * Get height at a specific position
 */
export function getHeightAt(
  cells: Map<string, number>,
  x: number,
  z: number
): number {
  const gridX = Math.floor(x)
  const gridZ = Math.floor(z)
  return cells.get(cellKey(gridX, gridZ)) ?? 0
}

/**
 * Get all cells that would be affected by a flood fill from a starting point
 */
export function floodFillCells(
  startX: number,
  startZ: number,
  maxCells: number = 100
): Array<{ x: number; z: number }> {
  const visited = new Set<string>()
  const queue: Array<{ x: number; z: number }> = [{ x: startX, z: startZ }]
  const result: Array<{ x: number; z: number }> = []

  while (queue.length > 0 && result.length < maxCells) {
    const current = queue.shift()!
    const key = cellKey(current.x, current.z)

    if (visited.has(key)) continue
    visited.add(key)
    result.push(current)

    // Add cardinal neighbors
    const neighbors = [
      { x: current.x, z: current.z - 1 },
      { x: current.x, z: current.z + 1 },
      { x: current.x - 1, z: current.z },
      { x: current.x + 1, z: current.z },
    ]

    for (const neighbor of neighbors) {
      const nKey = cellKey(neighbor.x, neighbor.z)
      if (!visited.has(nKey)) {
        queue.push(neighbor)
      }
    }
  }

  return result
}

/**
 * Generate a rectangular floor area with specified height
 */
export function generateRectangularFloor(
  startX: number,
  startZ: number,
  width: number,
  depth: number,
  height: number = 1
): Map<string, number> {
  const cells = new Map<string, number>()

  for (let x = startX; x < startX + width; x++) {
    for (let z = startZ; z < startZ + depth; z++) {
      cells.set(cellKey(x, z), height)
    }
  }

  return cells
}

/**
 * Generate default floor area (8x8 centered at origin offset)
 */
export function generateDefaultFloor(): Map<string, number> {
  return generateRectangularFloor(12, 12, 8, 8, 1)
}

/**
 * Maximum allowed height for buildings
 */
export const MAX_BUILDING_HEIGHT = 10

/**
 * Generate a unique edge key from cell coordinates, level, and side.
 * Format: "x,z,level,side"
 */
export function edgeKey(
  x: number,
  z: number,
  level: number,
  side: 'n' | 'e' | 's' | 'w'
): string {
  return `${x},${z},${level},${side}`
}

/**
 * Parse an edge key back to its components.
 */
export function parseEdgeKey(key: string): {
  x: number
  z: number
  level: number
  side: 'n' | 'e' | 's' | 'w'
} {
  const parts = key.split(',')
  return {
    x: parseInt(parts[0], 10),
    z: parseInt(parts[1], 10),
    level: parseInt(parts[2], 10),
    side: parts[3] as 'n' | 'e' | 's' | 'w',
  }
}

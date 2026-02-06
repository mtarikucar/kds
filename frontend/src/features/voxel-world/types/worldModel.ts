/**
 * World Model Types
 *
 * Cell-Edge model extending the existing floor cell system.
 * Provides edge-level structural classification for walls, windows,
 * doors, railings, and open areas (stair edges).
 */

export type CardinalDir = 'n' | 'e' | 's' | 'w'

/**
 * Edge key format: "x,z,level,side"
 * Uniquely identifies an edge in the world.
 */
export type EdgeKey = string

/**
 * A classified edge between a cell and its neighbor.
 */
export interface CellEdge {
  readonly x: number
  readonly z: number
  readonly level: number
  readonly side: CardinalDir
  readonly classification: EdgeClassification
}

/**
 * Structural classification of an edge.
 * Determines what geometry gets placed at that edge.
 */
export type EdgeClassification =
  | { readonly type: 'wall'; readonly variant: WallVariant }
  | { readonly type: 'window'; readonly variant: WindowVariant }
  | { readonly type: 'door'; readonly variant: DoorVariant }
  | { readonly type: 'railing'; readonly variant: RailingVariant }
  | { readonly type: 'open' }
  | { readonly type: 'none' }

export type WallVariant = 'straight' | 'corner-inner' | 'corner-outer' | 'end'
export type WindowVariant = 'standard' | 'arched' | 'small'
export type DoorVariant = 'single' | 'double' | 'arch'
export type RailingVariant = 'standard' | 'glass' | 'ornate'

/**
 * Corner classification at the junction of 4 cells.
 */
export interface CornerClassification {
  readonly x: number
  readonly z: number
  readonly level: number
  readonly type: 'inner' | 'outer' | 'none'
  readonly rotation: number
}

/**
 * Combined output from the rule engine: all edges and corners for a region.
 */
export interface StructuralOutput {
  readonly edges: ReadonlyArray<CellEdge>
  readonly corners: ReadonlyArray<CornerClassification>
}

/**
 * Generate a unique edge key from coordinates and side.
 */
export function edgeKey(x: number, z: number, level: number, side: CardinalDir): EdgeKey {
  return `${x},${z},${level},${side}`
}

/**
 * Parse an edge key back to its components.
 */
export function parseEdgeKey(key: EdgeKey): {
  x: number
  z: number
  level: number
  side: CardinalDir
} {
  const parts = key.split(',')
  return {
    x: parseInt(parts[0], 10),
    z: parseInt(parts[1], 10),
    level: parseInt(parts[2], 10),
    side: parts[3] as CardinalDir,
  }
}

/**
 * Get the opposite cardinal direction.
 */
export function oppositeDir(dir: CardinalDir): CardinalDir {
  switch (dir) {
    case 'n': return 's'
    case 's': return 'n'
    case 'e': return 'w'
    case 'w': return 'e'
  }
}

/**
 * Get the neighbor cell coordinates in a given direction.
 */
export function neighborCoords(
  x: number,
  z: number,
  dir: CardinalDir
): { x: number; z: number } {
  switch (dir) {
    case 'n': return { x, z: z - 1 }
    case 's': return { x, z: z + 1 }
    case 'e': return { x: x + 1, z }
    case 'w': return { x: x - 1, z }
  }
}

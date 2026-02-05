/**
 * Wall Generator
 *
 * Automatically generates walls at the edges of floor cells.
 * Walls appear where floor cells border empty space.
 * Supports multi-level buildings with walls per level.
 */

import { cellKey, parseKey } from './floorCellManager'

export type WallDirection = 'horizontal' | 'vertical'

export type WallType =
  | 'straight'
  | 'corner-inner' // Inside corner (floor on two adjacent sides)
  | 'corner-outer' // Outside corner (floor wraps around)
  | 'end' // Wall terminates

export interface WallEdge {
  x: number
  z: number
  level: number // Which level this edge is on
  side: 'n' | 's' | 'e' | 'w'
}

export interface WallSegment {
  id: string
  startX: number
  startZ: number
  endX: number
  endZ: number
  level: number // Which level this wall is on
  direction: WallDirection
  type: WallType
  length: number
}

export interface WallCorner {
  x: number
  z: number
  level: number // Which level this corner is on
  type: 'inner' | 'outer'
  rotation: number // degrees
}

export interface GeneratedWalls {
  segments: WallSegment[]
  corners: WallCorner[]
}

/**
 * Find all wall edges from floor cells with height support
 * An edge exists where a cell at a given level borders a cell with lower height
 */
export function findWallEdges(cells: Map<string, number>): WallEdge[] {
  const edges: WallEdge[] = []

  for (const [key, height] of cells) {
    if (height <= 0) continue

    const { x, z } = parseKey(key)

    // For each level of this cell, check if neighbors have lower height
    for (let level = 1; level <= height; level++) {
      const neighborN = cells.get(cellKey(x, z - 1)) ?? 0
      const neighborS = cells.get(cellKey(x, z + 1)) ?? 0
      const neighborE = cells.get(cellKey(x + 1, z)) ?? 0
      const neighborW = cells.get(cellKey(x - 1, z)) ?? 0

      // North edge - neighbor has lower height than current level
      if (neighborN < level) {
        edges.push({ x, z, level, side: 'n' })
      }
      // South edge
      if (neighborS < level) {
        edges.push({ x, z, level, side: 's' })
      }
      // East edge
      if (neighborE < level) {
        edges.push({ x, z, level, side: 'e' })
      }
      // West edge
      if (neighborW < level) {
        edges.push({ x, z, level, side: 'w' })
      }
    }
  }

  return edges
}

/**
 * Sort edges for merging (grouped by level)
 */
function sortEdges(edges: WallEdge[]): {
  horizontal: WallEdge[]
  vertical: WallEdge[]
} {
  const horizontal: WallEdge[] = []
  const vertical: WallEdge[] = []

  for (const edge of edges) {
    if (edge.side === 'n' || edge.side === 's') {
      horizontal.push(edge)
    } else {
      vertical.push(edge)
    }
  }

  // Sort horizontal by level, then z, then x
  horizontal.sort((a, b) => {
    const levelDiff = a.level - b.level
    if (levelDiff !== 0) return levelDiff
    const zDiff = a.z - b.z
    if (zDiff !== 0) return zDiff
    return a.x - b.x
  })

  // Sort vertical by level, then x, then z
  vertical.sort((a, b) => {
    const levelDiff = a.level - b.level
    if (levelDiff !== 0) return levelDiff
    const xDiff = a.x - b.x
    if (xDiff !== 0) return xDiff
    return a.z - b.z
  })

  return { horizontal, vertical }
}

/**
 * Merge adjacent edges into wall segments (with level support)
 */
function mergeEdges(
  edges: WallEdge[],
  direction: WallDirection
): WallSegment[] {
  if (edges.length === 0) return []

  const segments: WallSegment[] = []
  let segmentId = 0

  if (direction === 'horizontal') {
    // Group by level, z and side
    const groups = new Map<string, WallEdge[]>()
    for (const edge of edges) {
      const key = `${edge.level}-${edge.z}-${edge.side}`
      const group = groups.get(key) || []
      group.push(edge)
      groups.set(key, group)
    }

    for (const [, group] of groups) {
      // Sort by x
      group.sort((a, b) => a.x - b.x)

      let startIdx = 0
      while (startIdx < group.length) {
        const startEdge = group[startIdx]
        let endIdx = startIdx

        // Find consecutive edges
        while (
          endIdx + 1 < group.length &&
          group[endIdx + 1].x === group[endIdx].x + 1
        ) {
          endIdx++
        }

        const endEdge = group[endIdx]
        const length = endEdge.x - startEdge.x + 1

        // Calculate wall position
        const wallZ = startEdge.side === 'n' ? startEdge.z : startEdge.z + 1

        segments.push({
          id: `wall-h-${segmentId++}`,
          startX: startEdge.x,
          startZ: wallZ,
          endX: endEdge.x + 1,
          endZ: wallZ,
          level: startEdge.level,
          direction: 'horizontal',
          type: 'straight',
          length,
        })

        startIdx = endIdx + 1
      }
    }
  } else {
    // Vertical walls
    const groups = new Map<string, WallEdge[]>()
    for (const edge of edges) {
      const key = `${edge.level}-${edge.x}-${edge.side}`
      const group = groups.get(key) || []
      group.push(edge)
      groups.set(key, group)
    }

    for (const [, group] of groups) {
      // Sort by z
      group.sort((a, b) => a.z - b.z)

      let startIdx = 0
      while (startIdx < group.length) {
        const startEdge = group[startIdx]
        let endIdx = startIdx

        // Find consecutive edges
        while (
          endIdx + 1 < group.length &&
          group[endIdx + 1].z === group[endIdx].z + 1
        ) {
          endIdx++
        }

        const endEdge = group[endIdx]
        const length = endEdge.z - startEdge.z + 1

        // Calculate wall position
        const wallX = startEdge.side === 'w' ? startEdge.x : startEdge.x + 1

        segments.push({
          id: `wall-v-${segmentId++}`,
          startX: wallX,
          startZ: startEdge.z,
          endX: wallX,
          endZ: endEdge.z + 1,
          level: startEdge.level,
          direction: 'vertical',
          type: 'straight',
          length,
        })

        startIdx = endIdx + 1
      }
    }
  }

  return segments
}

/**
 * Find corner positions where walls meet (with level support)
 */
function findCorners(
  cells: Map<string, number>,
  segments: WallSegment[]
): WallCorner[] {
  const corners: WallCorner[] = []

  // Group segments by level
  const segmentsByLevel = new Map<number, WallSegment[]>()
  for (const seg of segments) {
    const level = seg.level
    const segs = segmentsByLevel.get(level) || []
    segs.push(seg)
    segmentsByLevel.set(level, segs)
  }

  // Find corners for each level
  for (const [level, levelSegments] of segmentsByLevel) {
    const cornerPositions = new Set<string>()

    // Find where horizontal and vertical segments meet
    for (const seg of levelSegments) {
      if (seg.direction === 'horizontal') {
        cornerPositions.add(`${seg.startX},${seg.startZ}`)
        cornerPositions.add(`${seg.endX},${seg.endZ}`)
      } else {
        cornerPositions.add(`${seg.startX},${seg.startZ}`)
        cornerPositions.add(`${seg.endX},${seg.endZ}`)
      }
    }

    // For each potential corner position, determine type and rotation
    for (const pos of cornerPositions) {
      const [x, z] = pos.split(',').map(Number)

      // Check which cells have height >= level around this corner
      const nw = (cells.get(cellKey(x - 1, z - 1)) ?? 0) >= level
      const ne = (cells.get(cellKey(x, z - 1)) ?? 0) >= level
      const sw = (cells.get(cellKey(x - 1, z)) ?? 0) >= level
      const se = (cells.get(cellKey(x, z)) ?? 0) >= level

      // Count active cells around corner
      const activeCount = [nw, ne, sw, se].filter(Boolean).length

      // Determine corner type
      if (activeCount === 1) {
        // Outer corner - only one cell active
        let rotation = 0
        if (nw) rotation = 180
        else if (ne) rotation = 270
        else if (sw) rotation = 90
        else if (se) rotation = 0

        corners.push({ x, z, level, type: 'outer', rotation })
      } else if (activeCount === 3) {
        // Inner corner - three cells active
        let rotation = 0
        if (!nw) rotation = 0
        else if (!ne) rotation = 90
        else if (!se) rotation = 180
        else if (!sw) rotation = 270

        corners.push({ x, z, level, type: 'inner', rotation })
      }
    }
  }

  return corners
}

/**
 * Generate walls from floor cells (with height support)
 */
export function generateWalls(cells: Map<string, number>): GeneratedWalls {
  const edges = findWallEdges(cells)
  const { horizontal, vertical } = sortEdges(edges)

  const horizontalSegments = mergeEdges(horizontal, 'horizontal')
  const verticalSegments = mergeEdges(vertical, 'vertical')
  const segments = [...horizontalSegments, ...verticalSegments]

  const corners = findCorners(cells, segments)

  return { segments, corners }
}

/**
 * Get total wall length for statistics
 */
export function getTotalWallLength(walls: GeneratedWalls): number {
  return walls.segments.reduce((total, seg) => total + seg.length, 0)
}

/**
 * Check if a position is blocked by a wall
 * Useful for pathfinding or placement validation
 */
export function isBlockedByWall(
  walls: GeneratedWalls,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number
): boolean {
  // Check if movement crosses any wall segment
  for (const seg of walls.segments) {
    if (seg.direction === 'horizontal') {
      // Horizontal wall at z = seg.startZ
      const wallZ = seg.startZ
      if (
        fromZ < wallZ !== toZ < wallZ && // Crossing the z line
        Math.min(fromX, toX) < seg.endX &&
        Math.max(fromX, toX) >= seg.startX
      ) {
        return true
      }
    } else {
      // Vertical wall at x = seg.startX
      const wallX = seg.startX
      if (
        fromX < wallX !== toX < wallX && // Crossing the x line
        Math.min(fromZ, toZ) < seg.endZ &&
        Math.max(fromZ, toZ) >= seg.startZ
      ) {
        return true
      }
    }
  }

  return false
}

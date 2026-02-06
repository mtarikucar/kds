/**
 * Corner Classifier
 *
 * Computes corner classifications from the set of classified edges.
 * Determines inner/outer corners where walls meet.
 */

import type { CellEdge, CornerClassification } from '../types/worldModel'
import { cellKey } from '../utils/procedural/floorCellManager'

/**
 * Compute corners from the classified edges and floor cells.
 * A corner occurs at a vertex shared by 4 cells where the wall configuration
 * creates an inner or outer corner.
 */
export function computeCorners(
  cells: ReadonlyMap<string, number>,
  edges: ReadonlyArray<CellEdge>
): CornerClassification[] {
  const corners: CornerClassification[] = []

  // Collect all potential corner positions from edges.
  // Each edge contributes its endpoint vertices.
  const cornerCandidates = new Map<string, Set<number>>()

  for (const edge of edges) {
    const wallType = edge.classification.type
    if (wallType !== 'wall' && wallType !== 'window' && wallType !== 'door') continue

    const positions = getEdgeCornerPositions(edge.x, edge.z, edge.side)
    for (const pos of positions) {
      const key = `${pos.x},${pos.z}`
      const levels = cornerCandidates.get(key) ?? new Set()
      levels.add(edge.level)
      cornerCandidates.set(key, levels)
    }
  }

  // Evaluate each candidate
  for (const [posKey, levels] of cornerCandidates) {
    const [x, z] = posKey.split(',').map(Number)

    for (const level of levels) {
      const corner = classifyCorner(cells, x, z, level)
      if (corner) {
        corners.push(corner)
      }
    }
  }

  return corners
}

/**
 * Get the two corner vertex positions that an edge contributes to.
 */
function getEdgeCornerPositions(
  x: number,
  z: number,
  side: 'n' | 'e' | 's' | 'w'
): Array<{ x: number; z: number }> {
  switch (side) {
    case 'n':
      return [{ x, z }, { x: x + 1, z }]
    case 's':
      return [{ x, z: z + 1 }, { x: x + 1, z: z + 1 }]
    case 'e':
      return [{ x: x + 1, z }, { x: x + 1, z: z + 1 }]
    case 'w':
      return [{ x, z }, { x, z: z + 1 }]
  }
}

/**
 * Classify a corner at a vertex position (x, z) for a given level.
 * Checks the 4 cells that share this vertex.
 */
function classifyCorner(
  cells: ReadonlyMap<string, number>,
  x: number,
  z: number,
  level: number
): CornerClassification | null {
  // The 4 cells sharing vertex (x, z):
  // NW = (x-1, z-1), NE = (x, z-1), SW = (x-1, z), SE = (x, z)
  const nw = (cells.get(cellKey(x - 1, z - 1)) ?? 0) >= level
  const ne = (cells.get(cellKey(x, z - 1)) ?? 0) >= level
  const sw = (cells.get(cellKey(x - 1, z)) ?? 0) >= level
  const se = (cells.get(cellKey(x, z)) ?? 0) >= level

  const activeCount = [nw, ne, sw, se].filter(Boolean).length

  if (activeCount === 1) {
    // Outer corner
    let rotation = 0
    if (nw) rotation = 180
    else if (ne) rotation = 270
    else if (sw) rotation = 90
    else if (se) rotation = 0

    return { x, z, level, type: 'outer', rotation }
  }

  if (activeCount === 3) {
    // Inner corner
    let rotation = 0
    if (!nw) rotation = 0
    else if (!ne) rotation = 90
    else if (!se) rotation = 180
    else if (!sw) rotation = 270

    return { x, z, level, type: 'inner', rotation }
  }

  return null
}

/**
 * Edge Classifier
 *
 * Finds exterior edges from floor cells and computes edge runs
 * for pattern matching. Refactored from wallGenerator.findWallEdges.
 */

import type { CardinalDir } from '../types/worldModel'
import type { EdgeRun } from '../types/ruleEngine'
import { cellKey, parseKey } from '../utils/procedural/floorCellManager'

/**
 * Raw exterior edge before classification.
 */
export interface ExteriorEdge {
  readonly x: number
  readonly z: number
  readonly level: number
  readonly side: CardinalDir
  readonly neighborHeight: number
  readonly cellHeight: number
  readonly isTopLevel: boolean
}

const CARDINAL_OFFSETS: Record<CardinalDir, { dx: number; dz: number }> = {
  n: { dx: 0, dz: -1 },
  s: { dx: 0, dz: 1 },
  e: { dx: 1, dz: 0 },
  w: { dx: -1, dz: 0 },
}

/**
 * Find all exterior edges from floor cells.
 * An edge is exterior when a cell at a given level borders a neighbor
 * whose height is less than that level.
 */
export function findExteriorEdges(
  cells: ReadonlyMap<string, number>
): ExteriorEdge[] {
  const edges: ExteriorEdge[] = []
  const sides: CardinalDir[] = ['n', 's', 'e', 'w']

  for (const [key, height] of cells) {
    if (height <= 0) continue

    const { x, z } = parseKey(key)

    for (let level = 1; level <= height; level++) {
      for (const side of sides) {
        const offset = CARDINAL_OFFSETS[side]
        const neighborHeight = cells.get(cellKey(x + offset.dx, z + offset.dz)) ?? 0

        if (neighborHeight < level) {
          edges.push({
            x,
            z,
            level,
            side,
            neighborHeight,
            cellHeight: height,
            isTopLevel: level === height,
          })
        }
      }
    }
  }

  return edges
}

/**
 * Compute edge runs: groups of consecutive exterior edges in the same
 * direction on the same level. Used for pattern matching (e.g., windows).
 *
 * Edges are consecutive if they are adjacent along the wall's axis:
 * - For N/S sides: consecutive in X
 * - For E/W sides: consecutive in Z
 */
export function computeEdgeRuns(edges: ExteriorEdge[]): EdgeRun[] {
  const runs: EdgeRun[] = []

  // Group by (level, side)
  const groups = new Map<string, ExteriorEdge[]>()
  for (const edge of edges) {
    const groupKey = `${edge.level},${edge.side}`
    const group = groups.get(groupKey) ?? []
    group.push(edge)
    groups.set(groupKey, group)
  }

  for (const [, group] of groups) {
    const side = group[0].side
    const level = group[0].level
    const isHorizontal = side === 'n' || side === 's'

    // Sort by primary axis
    const sorted = [...group].sort((a, b) => {
      if (isHorizontal) {
        if (a.z !== b.z) return a.z - b.z
        return a.x - b.x
      }
      if (a.x !== b.x) return a.x - b.x
      return a.z - b.z
    })

    // Find consecutive runs
    let runStart = 0
    while (runStart < sorted.length) {
      const runEdges: Array<{ x: number; z: number }> = [
        { x: sorted[runStart].x, z: sorted[runStart].z },
      ]

      let runEnd = runStart
      while (runEnd + 1 < sorted.length) {
        const current = sorted[runEnd]
        const next = sorted[runEnd + 1]

        const isConsecutive = isHorizontal
          ? next.z === current.z && next.x === current.x + 1
          : next.x === current.x && next.z === current.z + 1

        if (isConsecutive) {
          runEnd++
          runEdges.push({ x: next.x, z: next.z })
        } else {
          break
        }
      }

      runs.push({
        side,
        level,
        edges: runEdges,
        length: runEdges.length,
      })

      runStart = runEnd + 1
    }
  }

  return runs
}

/**
 * Look up the run and position for a specific edge.
 * Returns { runLength, runPosition } or null if not found in any run.
 */
export function findEdgeInRuns(
  runs: ReadonlyArray<EdgeRun>,
  x: number,
  z: number,
  level: number,
  side: CardinalDir
): { runLength: number; runPosition: number } | null {
  for (const run of runs) {
    if (run.level !== level || run.side !== side) continue

    for (let i = 0; i < run.edges.length; i++) {
      const e = run.edges[i]
      if (e.x === x && e.z === z) {
        return { runLength: run.length, runPosition: i }
      }
    }
  }
  return null
}

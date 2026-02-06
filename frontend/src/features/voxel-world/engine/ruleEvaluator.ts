/**
 * Rule Evaluator
 *
 * Main entry point for the rule engine. Evaluates all exterior edges
 * against the rule set and produces the structural output.
 */

import type { StairSegment } from '../types/voxel'
import type {
  CellEdge,
  EdgeClassification,
  StructuralOutput,
  EdgeKey,
} from '../types/worldModel'
import { edgeKey } from '../types/worldModel'
import type { StructuralRule, RuleContext, EdgeRun } from '../types/ruleEngine'
import {
  findExteriorEdges,
  computeEdgeRuns,
  findEdgeInRuns,
  type ExteriorEdge,
} from './edgeClassifier'
import { computeCorners } from './cornerClassifier'
import { sortRulesByPriority, resolveEdge } from './conflictResolver'

/**
 * Evaluate all edges in the world and produce a complete structural output.
 */
export function evaluateAllEdges(
  cells: ReadonlyMap<string, number>,
  stairs: ReadonlyMap<string, StairSegment>,
  overrides: ReadonlyMap<EdgeKey, EdgeClassification>,
  rules: ReadonlyArray<StructuralRule>
): StructuralOutput {
  const exteriorEdges = findExteriorEdges(cells)
  const edgeRuns = computeEdgeRuns(exteriorEdges)
  const sortedRules = sortRulesByPriority(rules)

  const classifiedEdges = classifyEdges(
    exteriorEdges,
    edgeRuns,
    cells,
    stairs,
    overrides,
    sortedRules
  )

  const corners = computeCorners(cells, classifiedEdges)

  return { edges: classifiedEdges, corners }
}

/**
 * Evaluate edges within a specific cell region (for incremental updates).
 * Includes a 1-cell border around the region to handle edge boundaries.
 */
export function evaluateRegion(
  cells: ReadonlyMap<string, number>,
  stairs: ReadonlyMap<string, StairSegment>,
  overrides: ReadonlyMap<EdgeKey, EdgeClassification>,
  rules: ReadonlyArray<StructuralRule>,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number
): StructuralOutput {
  // Include 1-cell border for accurate edge detection at boundaries
  const expandedMinX = minX - 1
  const expandedMaxX = maxX + 1
  const expandedMinZ = minZ - 1
  const expandedMaxZ = maxZ + 1

  const allExteriorEdges = findExteriorEdges(cells)

  // Filter to edges within the expanded region
  const regionEdges = allExteriorEdges.filter(
    (e) =>
      e.x >= expandedMinX &&
      e.x <= expandedMaxX &&
      e.z >= expandedMinZ &&
      e.z <= expandedMaxZ
  )

  // Edge runs need the full set for accurate run length calculation
  const edgeRuns = computeEdgeRuns(allExteriorEdges)
  const sortedRules = sortRulesByPriority(rules)

  const classifiedEdges = classifyEdges(
    regionEdges,
    edgeRuns,
    cells,
    stairs,
    overrides,
    sortedRules
  )

  // Only return corners within the original (non-expanded) region
  const corners = computeCorners(cells, classifiedEdges).filter(
    (c) => c.x >= minX && c.x <= maxX + 1 && c.z >= minZ && c.z <= maxZ + 1
  )

  // Filter classified edges to the original region
  const trimmedEdges = classifiedEdges.filter(
    (e) => e.x >= minX && e.x <= maxX && e.z >= minZ && e.z <= maxZ
  )

  return { edges: trimmedEdges, corners }
}

/**
 * Classify a list of exterior edges using the rule set.
 */
function classifyEdges(
  exteriorEdges: ReadonlyArray<ExteriorEdge>,
  edgeRuns: ReadonlyArray<EdgeRun>,
  cells: ReadonlyMap<string, number>,
  stairs: ReadonlyMap<string, StairSegment>,
  overrides: ReadonlyMap<EdgeKey, EdgeClassification>,
  sortedRules: ReadonlyArray<StructuralRule>
): CellEdge[] {
  const classified: CellEdge[] = []

  for (const edge of exteriorEdges) {
    const key = edgeKey(edge.x, edge.z, edge.level, edge.side)

    // User overrides always win
    const override = overrides.get(key)
    if (override) {
      classified.push({
        x: edge.x,
        z: edge.z,
        level: edge.level,
        side: edge.side,
        classification: override,
      })
      continue
    }

    // Look up run info for pattern matching
    const runInfo = findEdgeInRuns(edgeRuns, edge.x, edge.z, edge.level, edge.side)

    const ctx: RuleContext = {
      cells,
      stairs,
      overrides,
      edge: {
        x: edge.x,
        z: edge.z,
        level: edge.level,
        side: edge.side,
      },
      neighborHeight: edge.neighborHeight,
      cellHeight: edge.cellHeight,
      runLength: runInfo?.runLength ?? 1,
      runPosition: runInfo?.runPosition ?? 0,
      isTopLevel: edge.isTopLevel,
    }

    const classification = resolveEdge(sortedRules, ctx)

    classified.push({
      x: edge.x,
      z: edge.z,
      level: edge.level,
      side: edge.side,
      classification,
    })
  }

  return classified
}

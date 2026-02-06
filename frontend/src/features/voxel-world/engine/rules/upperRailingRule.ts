/**
 * Upper Railing Rule
 *
 * Places railings at the top level of cells with height >= 2
 * where the neighbor is shorter. Does not apply where stairs exist.
 */

import type { StructuralRule, RuleContext } from '../../types/ruleEngine'
import { RulePriority } from '../../types/ruleEngine'
import type { EdgeClassification } from '../../types/worldModel'
import { hasStairAtEdge } from '../../utils/procedural/stairGenerator'
import type { StairSegment } from '../../types/voxel'

export const upperRailingRule: StructuralRule = {
  id: 'upper-railing',
  name: 'Upper Level Railing',
  priority: RulePriority.DEFAULT,

  evaluate(ctx: RuleContext): EdgeClassification | null {
    const { edge, cellHeight, neighborHeight, isTopLevel, stairs } = ctx

    // Only applies to top level of cells with height >= 2
    if (!isTopLevel || cellHeight < 2) return null

    // Only where neighbor doesn't reach this level
    if (neighborHeight >= edge.level) return null

    // Don't place railing where stair connects
    const stairLevel = edge.level - 1
    const stairsMap = stairs as Map<string, StairSegment>
    if (stairLevel >= 1 && hasStairAtEdge(stairsMap, edge.x, edge.z, stairLevel, edge.side)) {
      return null
    }

    return { type: 'railing', variant: 'standard' }
  },
}

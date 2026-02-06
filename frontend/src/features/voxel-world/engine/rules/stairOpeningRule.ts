/**
 * Stair Opening Rule
 *
 * Marks edges as 'open' where stairs exist, suppressing wall generation.
 */

import type { StructuralRule, RuleContext } from '../../types/ruleEngine'
import { RulePriority } from '../../types/ruleEngine'
import type { EdgeClassification } from '../../types/worldModel'
import { hasStairAtEdge } from '../../utils/procedural/stairGenerator'
import type { StairSegment } from '../../types/voxel'

export const stairOpeningRule: StructuralRule = {
  id: 'stair-opening',
  name: 'Stair Opening',
  priority: RulePriority.STRUCTURAL,

  evaluate(ctx: RuleContext): EdgeClassification | null {
    const { edge, stairs } = ctx
    // Stair connects level-1 to level, so we check at level-1
    const stairLevel = edge.level - 1
    if (stairLevel < 1) return null

    const stairsMap = stairs as Map<string, StairSegment>
    if (hasStairAtEdge(stairsMap, edge.x, edge.z, stairLevel, edge.side)) {
      return { type: 'open' }
    }

    return null
  },
}

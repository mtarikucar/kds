/**
 * Default Wall Rule
 *
 * Fallback: any exterior edge that no other rule classified
 * becomes a straight wall.
 */

import type { StructuralRule, RuleContext } from '../../types/ruleEngine'
import { RulePriority } from '../../types/ruleEngine'
import type { EdgeClassification } from '../../types/worldModel'

export const defaultWallRule: StructuralRule = {
  id: 'default-wall',
  name: 'Default Wall',
  priority: RulePriority.DEFAULT,

  evaluate(_ctx: RuleContext): EdgeClassification | null {
    return { type: 'wall', variant: 'straight' }
  },
}

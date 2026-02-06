/**
 * Default rule set for the procedural structure engine.
 *
 * Rules are evaluated in priority order (lowest number first).
 * First match wins within the same priority level.
 */

import type { StructuralRule } from '../../types/ruleEngine'
import { stairOpeningRule } from './stairOpeningRule'
import { upperRailingRule } from './upperRailingRule'
import { tripleWallWindowRule } from './tripleWallWindowRule'
import { defaultWallRule } from './defaultWallRule'

/**
 * Default rules applied to all layouts.
 * Order within same priority doesn't matter (sorted by evaluator).
 */
export const DEFAULT_RULES: ReadonlyArray<StructuralRule> = [
  stairOpeningRule,
  tripleWallWindowRule,
  upperRailingRule,
  defaultWallRule,
]

export {
  stairOpeningRule,
  upperRailingRule,
  tripleWallWindowRule,
  defaultWallRule,
}

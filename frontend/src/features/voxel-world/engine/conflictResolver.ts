/**
 * Conflict Resolver
 *
 * Priority-based resolution when multiple rules match the same edge.
 * Lower priority number wins. If same priority, first rule wins.
 */

import type { EdgeClassification } from '../types/worldModel'
import type { StructuralRule, RuleContext } from '../types/ruleEngine'

/**
 * Result from evaluating a single rule.
 */
interface RuleResult {
  readonly rule: StructuralRule
  readonly classification: EdgeClassification
}

/**
 * Evaluate all rules against a context and resolve conflicts.
 * Rules are evaluated in priority order (lowest number first).
 * First match within the highest priority wins.
 */
export function resolveEdge(
  sortedRules: ReadonlyArray<StructuralRule>,
  ctx: RuleContext
): EdgeClassification {
  let bestResult: RuleResult | null = null

  for (const rule of sortedRules) {
    // If we already have a result with higher priority, skip lower-priority rules
    if (bestResult && rule.priority > bestResult.rule.priority) {
      break
    }

    const result = rule.evaluate(ctx)
    if (result !== null) {
      if (!bestResult || rule.priority < bestResult.rule.priority) {
        bestResult = { rule, classification: result }
      }
      // First match at this priority level wins
      if (bestResult.rule.priority === rule.priority) {
        break
      }
    }
  }

  // Default fallback: straight wall
  return bestResult?.classification ?? { type: 'wall', variant: 'straight' }
}

/**
 * Sort rules by priority (ascending). Stable sort preserves insertion order
 * within the same priority level.
 */
export function sortRulesByPriority(
  rules: ReadonlyArray<StructuralRule>
): StructuralRule[] {
  return [...rules].sort((a, b) => a.priority - b.priority)
}

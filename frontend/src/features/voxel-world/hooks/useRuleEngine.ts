/**
 * useRuleEngine Hook
 *
 * Memoized rule evaluation that produces structural output
 * from the current world state. Integrates the chunk manager
 * for incremental updates.
 */

import { useMemo, useRef } from 'react'
import type { StairSegment } from '../types/voxel'
import type { EdgeClassification, StructuralOutput, EdgeKey } from '../types/worldModel'
import type { StructuralRule } from '../types/ruleEngine'
import { evaluateAllEdges } from '../engine/ruleEvaluator'
import { DEFAULT_RULES } from '../engine/rules'

interface UseRuleEngineOptions {
  rules?: ReadonlyArray<StructuralRule>
  enabled?: boolean
}

/**
 * Hook that evaluates the rule engine and returns structural output.
 * Memoized: only re-evaluates when cells, stairs, or overrides change.
 */
export function useRuleEngine(
  cells: ReadonlyMap<string, number>,
  stairs: ReadonlyMap<string, StairSegment>,
  overrides: ReadonlyMap<EdgeKey, EdgeClassification>,
  options: UseRuleEngineOptions = {}
): StructuralOutput {
  const { rules = DEFAULT_RULES, enabled = true } = options

  // Cache the empty output to avoid re-creating
  const emptyOutput = useRef<StructuralOutput>({ edges: [], corners: [] })

  return useMemo(() => {
    if (!enabled || cells.size === 0) {
      return emptyOutput.current
    }

    return evaluateAllEdges(cells, stairs, overrides, rules)
  }, [cells, stairs, overrides, rules, enabled])
}

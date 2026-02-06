/**
 * Rule Engine Slice
 *
 * Manages the rule engine configuration and structural output cache.
 * The structural cache is rebuilt when floor cells, stairs, or overrides change.
 */

import type { StructuralRule } from '../types/ruleEngine'
import type { StructuralOutput } from '../types/worldModel'
import type { ChunkManagerState } from '../types/chunks'
import { DEFAULT_RULES } from '../engine/rules'

/**
 * Rule engine state.
 */
export interface RuleEngineSliceState {
  readonly rules: ReadonlyArray<StructuralRule>
  readonly structuralCache: StructuralOutput | null
  readonly chunkManagerState: ChunkManagerState | null
  readonly enablePatternMatching: boolean
}

/**
 * Actions for the rule engine.
 */
export interface RuleEngineSliceActions {
  setRules: (rules: ReadonlyArray<StructuralRule>) => void
  setEnablePatternMatching: (enabled: boolean) => void
  invalidateStructuralCache: () => void
  getStructuralOutput: () => StructuralOutput | null
}

/**
 * Create default rule engine state.
 */
export function createDefaultRuleEngineState(): RuleEngineSliceState {
  return {
    rules: DEFAULT_RULES,
    structuralCache: null,
    chunkManagerState: null,
    enablePatternMatching: true,
  }
}

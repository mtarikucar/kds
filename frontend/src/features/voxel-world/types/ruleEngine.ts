/**
 * Rule Engine Types
 *
 * Defines the structural rule system that replaces hardcoded
 * wall/railing generation with a priority-based rule evaluator.
 */

import type { CardinalDir, EdgeClassification } from './worldModel'
import type { StairSegment } from './voxel'

/**
 * Rule priorities. Lower number = higher priority.
 * User overrides always win (OVERRIDE = 0).
 */
export enum RulePriority {
  OVERRIDE = 0,
  STRUCTURAL = 10,
  PATTERN = 20,
  DEFAULT = 30,
  COSMETIC = 40,
}

/**
 * Context passed to each rule during evaluation.
 * Contains all information a rule needs to make a classification decision.
 */
export interface RuleContext {
  readonly cells: ReadonlyMap<string, number>
  readonly stairs: ReadonlyMap<string, StairSegment>
  readonly overrides: ReadonlyMap<string, EdgeClassification>
  readonly edge: {
    readonly x: number
    readonly z: number
    readonly level: number
    readonly side: CardinalDir
  }
  readonly neighborHeight: number
  readonly cellHeight: number
  readonly runLength: number
  readonly runPosition: number
  readonly isTopLevel: boolean
}

/**
 * A structural rule that evaluates an edge and optionally classifies it.
 * Returns null if the rule does not apply.
 */
export interface StructuralRule {
  readonly id: string
  readonly name: string
  readonly priority: RulePriority
  evaluate(ctx: RuleContext): EdgeClassification | null
}

/**
 * Configuration for the rule engine.
 */
export interface RuleEngineConfig {
  readonly rules: ReadonlyArray<StructuralRule>
  readonly enablePatternMatching: boolean
}

/**
 * Edge run: a sequence of consecutive exterior edges in the same direction.
 * Used for pattern matching (e.g., "3+ walls -> middle becomes window").
 */
export interface EdgeRun {
  readonly side: CardinalDir
  readonly level: number
  readonly edges: ReadonlyArray<{ x: number; z: number }>
  readonly length: number
}

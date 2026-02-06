/**
 * Sparse Window Rule
 *
 * Places windows sparingly along long wall runs. Windows appear only on
 * runs of 6+ edges, and at most one window per 5 wall segments.
 * Uses a deterministic hash to keep placement stable across rebuilds.
 */

import type { StructuralRule, RuleContext } from '../../types/ruleEngine'
import { RulePriority } from '../../types/ruleEngine'
import type { EdgeClassification } from '../../types/worldModel'

/** Simple deterministic hash for stable window placement */
function stableHash(x: number, z: number, level: number, side: string): number {
  let h = 2166136261
  h = (h ^ x) * 16777619
  h = (h ^ z) * 16777619
  h = (h ^ level) * 16777619
  h = (h ^ side.charCodeAt(0)) * 16777619
  return Math.abs(h)
}

/** Window spacing: at most 1 window per this many wall segments */
const WINDOW_SPACING = 5
/** Minimum run length before any windows appear */
const MIN_RUN_LENGTH = 6
/** Minimum distance from wall corners (first/last edges in run) */
const CORNER_MARGIN = 2

export const tripleWallWindowRule: StructuralRule = {
  id: 'sparse-window',
  name: 'Sparse Window',
  priority: RulePriority.PATTERN,

  evaluate(ctx: RuleContext): EdgeClassification | null {
    const { runLength, runPosition, isTopLevel, edge } = ctx

    // Don't place windows on railing-level edges
    if (isTopLevel && ctx.cellHeight >= 2) return null

    // Run must be long enough
    if (runLength < MIN_RUN_LENGTH) return null

    // Keep margin from corners — no windows near wall ends
    if (runPosition < CORNER_MARGIN || runPosition > runLength - 1 - CORNER_MARGIN) return null

    // Only allow windows at positions that are multiples of WINDOW_SPACING
    // offset by 2 to center them within the usable range
    const usableStart = CORNER_MARGIN
    const posInUsable = runPosition - usableStart

    if (posInUsable % WINDOW_SPACING !== 0) return null

    // Additional filter: use hash to skip ~40% of eligible positions
    // This prevents perfectly regular spacing from looking artificial
    const hash = stableHash(edge.x, edge.z, edge.level, edge.side)
    if (hash % 10 < 4) return null

    return { type: 'window', variant: 'standard' }
  },
}

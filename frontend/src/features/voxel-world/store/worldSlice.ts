/**
 * World Slice
 *
 * Extracted world state: floor cells, stairs, and edge overrides.
 * Provides actions that go through the command log for undo/redo.
 */

import type { EdgeClassification, EdgeKey } from '../types/worldModel'
import type { StairSegment, StairSide } from '../types/voxel'

/**
 * World-specific state managed by the command log.
 */
export interface WorldSliceState {
  readonly floorCells: Map<string, number>
  readonly stairs: Map<string, StairSegment>
  readonly overrides: Map<string, EdgeClassification>
}

/**
 * Actions for world state modifications.
 * These are the high-level actions that create commands internally.
 */
export interface WorldSliceActions {
  setEdgeOverride: (edgeKey: EdgeKey, classification: EdgeClassification) => void
  clearEdgeOverride: (edgeKey: EdgeKey) => void
  clearAllOverrides: () => void
  getOverrides: () => ReadonlyMap<string, EdgeClassification>
}

/**
 * Create default world slice state.
 */
export function createDefaultWorldSliceState(): WorldSliceState {
  return {
    floorCells: new Map<string, number>(),
    stairs: new Map<string, StairSegment>(),
    overrides: new Map<string, EdgeClassification>(),
  }
}

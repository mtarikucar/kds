/**
 * Command Executor
 *
 * Applies and inverts commands against the world state.
 * Each command type has a corresponding apply and invert operation.
 */

import type {
  AnyCommand,
  CellSetHeightCommand,
  CellClearCommand,
  StairAddCommand,
  StairRemoveCommand,
  ObjectAddCommand,
  ObjectUpdateCommand,
  ObjectRemoveCommand,
  ObjectMoveCommand,
  OverrideSetCommand,
  OverrideClearCommand,
  BatchCommand,
} from '../types/commandLog'
import type { EdgeClassification } from '../types/worldModel'
import type { VoxelObject, StairSegment, StairSide } from '../types/voxel'
import { cellKey } from '../utils/procedural/floorCellManager'

/**
 * World state snapshot that commands operate on.
 * This is the minimal interface needed by the executor.
 */
export interface WorldStateSnapshot {
  readonly floorCells: Map<string, number>
  readonly stairs: Map<string, StairSegment>
  readonly objects: ReadonlyArray<VoxelObject>
  readonly overrides: Map<string, EdgeClassification>
}

function stairKey(x: number, z: number, level: number, side: StairSide): string {
  return `${x},${z},${level},${side}`
}

/**
 * Apply a command to the world state (forward/do).
 * Returns a new state snapshot - never mutates.
 */
export function applyCommand(
  state: WorldStateSnapshot,
  command: AnyCommand
): WorldStateSnapshot {
  switch (command.type) {
    case 'cell:set-height':
      return applyCellSetHeight(state, command)
    case 'cell:clear':
      return applyCellClear(state, command)
    case 'stair:add':
      return applyStairAdd(state, command)
    case 'stair:remove':
      return applyStairRemove(state, command)
    case 'object:add':
      return applyObjectAdd(state, command)
    case 'object:update':
      return applyObjectUpdate(state, command)
    case 'object:remove':
      return applyObjectRemove(state, command)
    case 'object:move':
      return applyObjectMove(state, command)
    case 'override:set':
      return applyOverrideSet(state, command)
    case 'override:clear':
      return applyOverrideClear(state, command)
    case 'batch':
      return applyBatch(state, command)
  }
}

/**
 * Invert a command (apply its reverse for undo).
 * Returns a new state snapshot - never mutates.
 */
export function invertCommand(
  state: WorldStateSnapshot,
  command: AnyCommand
): WorldStateSnapshot {
  switch (command.type) {
    case 'cell:set-height':
      return invertCellSetHeight(state, command)
    case 'cell:clear':
      return invertCellClear(state, command)
    case 'stair:add':
      return invertStairAdd(state, command)
    case 'stair:remove':
      return invertStairRemove(state, command)
    case 'object:add':
      return invertObjectAdd(state, command)
    case 'object:update':
      return invertObjectUpdate(state, command)
    case 'object:remove':
      return invertObjectRemove(state, command)
    case 'object:move':
      return invertObjectMove(state, command)
    case 'override:set':
      return invertOverrideSet(state, command)
    case 'override:clear':
      return invertOverrideClear(state, command)
    case 'batch':
      return invertBatch(state, command)
  }
}

// --- Cell commands ---

function applyCellSetHeight(
  state: WorldStateSnapshot,
  cmd: CellSetHeightCommand
): WorldStateSnapshot {
  const newCells = new Map(state.floorCells)
  if (cmd.newHeight > 0) {
    newCells.set(cellKey(cmd.x, cmd.z), cmd.newHeight)
  } else {
    newCells.delete(cellKey(cmd.x, cmd.z))
  }
  return { ...state, floorCells: newCells }
}

function invertCellSetHeight(
  state: WorldStateSnapshot,
  cmd: CellSetHeightCommand
): WorldStateSnapshot {
  const newCells = new Map(state.floorCells)
  if (cmd.previousHeight > 0) {
    newCells.set(cellKey(cmd.x, cmd.z), cmd.previousHeight)
  } else {
    newCells.delete(cellKey(cmd.x, cmd.z))
  }
  return { ...state, floorCells: newCells }
}

function applyCellClear(
  state: WorldStateSnapshot,
  cmd: CellClearCommand
): WorldStateSnapshot {
  const newCells = new Map(state.floorCells)
  newCells.delete(cellKey(cmd.x, cmd.z))
  return { ...state, floorCells: newCells }
}

function invertCellClear(
  state: WorldStateSnapshot,
  cmd: CellClearCommand
): WorldStateSnapshot {
  const newCells = new Map(state.floorCells)
  if (cmd.previousHeight > 0) {
    newCells.set(cellKey(cmd.x, cmd.z), cmd.previousHeight)
  }
  return { ...state, floorCells: newCells }
}

// --- Stair commands ---

function applyStairAdd(
  state: WorldStateSnapshot,
  cmd: StairAddCommand
): WorldStateSnapshot {
  const newStairs = new Map(state.stairs)
  const key = stairKey(cmd.x, cmd.z, cmd.level, cmd.side)
  newStairs.set(key, {
    id: key,
    x: cmd.x,
    z: cmd.z,
    level: cmd.level,
    side: cmd.side,
    steps: 4,
  })
  return { ...state, stairs: newStairs }
}

function invertStairAdd(
  state: WorldStateSnapshot,
  cmd: StairAddCommand
): WorldStateSnapshot {
  const newStairs = new Map(state.stairs)
  newStairs.delete(stairKey(cmd.x, cmd.z, cmd.level, cmd.side))
  return { ...state, stairs: newStairs }
}

function applyStairRemove(
  state: WorldStateSnapshot,
  cmd: StairRemoveCommand
): WorldStateSnapshot {
  const newStairs = new Map(state.stairs)
  newStairs.delete(stairKey(cmd.x, cmd.z, cmd.level, cmd.side))
  return { ...state, stairs: newStairs }
}

function invertStairRemove(
  state: WorldStateSnapshot,
  cmd: StairRemoveCommand
): WorldStateSnapshot {
  const newStairs = new Map(state.stairs)
  const key = stairKey(cmd.x, cmd.z, cmd.level, cmd.side)
  newStairs.set(key, {
    id: key,
    x: cmd.x,
    z: cmd.z,
    level: cmd.level,
    side: cmd.side,
    steps: 4,
  })
  return { ...state, stairs: newStairs }
}

// --- Object commands ---

function applyObjectAdd(
  state: WorldStateSnapshot,
  cmd: ObjectAddCommand
): WorldStateSnapshot {
  return { ...state, objects: [...state.objects, cmd.object] }
}

function invertObjectAdd(
  state: WorldStateSnapshot,
  cmd: ObjectAddCommand
): WorldStateSnapshot {
  return {
    ...state,
    objects: state.objects.filter((obj) => obj.id !== cmd.object.id),
  }
}

function applyObjectUpdate(
  state: WorldStateSnapshot,
  cmd: ObjectUpdateCommand
): WorldStateSnapshot {
  return {
    ...state,
    objects: state.objects.map((obj) =>
      obj.id === cmd.objectId ? { ...obj, ...cmd.newState } : obj
    ),
  }
}

function invertObjectUpdate(
  state: WorldStateSnapshot,
  cmd: ObjectUpdateCommand
): WorldStateSnapshot {
  return {
    ...state,
    objects: state.objects.map((obj) =>
      obj.id === cmd.objectId ? { ...obj, ...cmd.previousState } : obj
    ),
  }
}

function applyObjectRemove(
  state: WorldStateSnapshot,
  cmd: ObjectRemoveCommand
): WorldStateSnapshot {
  return {
    ...state,
    objects: state.objects.filter((obj) => obj.id !== cmd.object.id),
  }
}

function invertObjectRemove(
  state: WorldStateSnapshot,
  cmd: ObjectRemoveCommand
): WorldStateSnapshot {
  return { ...state, objects: [...state.objects, cmd.object] }
}

function applyObjectMove(
  state: WorldStateSnapshot,
  cmd: ObjectMoveCommand
): WorldStateSnapshot {
  return {
    ...state,
    objects: state.objects.map((obj) =>
      obj.id === cmd.objectId
        ? { ...obj, position: cmd.newPosition }
        : obj
    ),
  }
}

function invertObjectMove(
  state: WorldStateSnapshot,
  cmd: ObjectMoveCommand
): WorldStateSnapshot {
  return {
    ...state,
    objects: state.objects.map((obj) =>
      obj.id === cmd.objectId
        ? { ...obj, position: cmd.previousPosition }
        : obj
    ),
  }
}

// --- Override commands ---

function applyOverrideSet(
  state: WorldStateSnapshot,
  cmd: OverrideSetCommand
): WorldStateSnapshot {
  const newOverrides = new Map(state.overrides)
  newOverrides.set(cmd.edgeKey, cmd.newClassification)
  return { ...state, overrides: newOverrides }
}

function invertOverrideSet(
  state: WorldStateSnapshot,
  cmd: OverrideSetCommand
): WorldStateSnapshot {
  const newOverrides = new Map(state.overrides)
  if (cmd.previousClassification) {
    newOverrides.set(cmd.edgeKey, cmd.previousClassification)
  } else {
    newOverrides.delete(cmd.edgeKey)
  }
  return { ...state, overrides: newOverrides }
}

function applyOverrideClear(
  state: WorldStateSnapshot,
  cmd: OverrideClearCommand
): WorldStateSnapshot {
  const newOverrides = new Map(state.overrides)
  newOverrides.delete(cmd.edgeKey)
  return { ...state, overrides: newOverrides }
}

function invertOverrideClear(
  state: WorldStateSnapshot,
  cmd: OverrideClearCommand
): WorldStateSnapshot {
  const newOverrides = new Map(state.overrides)
  newOverrides.set(cmd.edgeKey, cmd.previousClassification)
  return { ...state, overrides: newOverrides }
}

// --- Batch commands ---

function applyBatch(
  state: WorldStateSnapshot,
  cmd: BatchCommand
): WorldStateSnapshot {
  let current = state
  for (const subCmd of cmd.commands) {
    current = applyCommand(current, subCmd)
  }
  return current
}

function invertBatch(
  state: WorldStateSnapshot,
  cmd: BatchCommand
): WorldStateSnapshot {
  let current = state
  // Invert in reverse order
  for (let i = cmd.commands.length - 1; i >= 0; i--) {
    current = invertCommand(current, cmd.commands[i])
  }
  return current
}

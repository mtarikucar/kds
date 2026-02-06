/**
 * Command Factory
 *
 * Helper functions to create typed commands with auto-generated IDs.
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
import type { VoxelObject, VoxelPosition, StairSide } from '../types/voxel'
import type { EdgeClassification, EdgeKey } from '../types/worldModel'

let commandCounter = 0

function generateId(): string {
  commandCounter += 1
  return `cmd-${Date.now()}-${commandCounter}`
}

export function cellSetHeight(
  x: number,
  z: number,
  previousHeight: number,
  newHeight: number
): CellSetHeightCommand {
  return {
    id: generateId(),
    type: 'cell:set-height',
    timestamp: Date.now(),
    x,
    z,
    previousHeight,
    newHeight,
  }
}

export function cellClear(
  x: number,
  z: number,
  previousHeight: number
): CellClearCommand {
  return {
    id: generateId(),
    type: 'cell:clear',
    timestamp: Date.now(),
    x,
    z,
    previousHeight,
  }
}

export function stairAdd(
  x: number,
  z: number,
  level: number,
  side: StairSide
): StairAddCommand {
  return {
    id: generateId(),
    type: 'stair:add',
    timestamp: Date.now(),
    x,
    z,
    level,
    side,
  }
}

export function stairRemove(
  x: number,
  z: number,
  level: number,
  side: StairSide
): StairRemoveCommand {
  return {
    id: generateId(),
    type: 'stair:remove',
    timestamp: Date.now(),
    x,
    z,
    level,
    side,
  }
}

export function objectAdd(object: VoxelObject): ObjectAddCommand {
  return {
    id: generateId(),
    type: 'object:add',
    timestamp: Date.now(),
    object,
  }
}

export function objectUpdate(
  objectId: string,
  previousState: Partial<VoxelObject>,
  newState: Partial<VoxelObject>
): ObjectUpdateCommand {
  return {
    id: generateId(),
    type: 'object:update',
    timestamp: Date.now(),
    objectId,
    previousState,
    newState,
  }
}

export function objectRemove(object: VoxelObject): ObjectRemoveCommand {
  return {
    id: generateId(),
    type: 'object:remove',
    timestamp: Date.now(),
    object,
  }
}

export function objectMove(
  objectId: string,
  previousPosition: VoxelPosition,
  newPosition: VoxelPosition
): ObjectMoveCommand {
  return {
    id: generateId(),
    type: 'object:move',
    timestamp: Date.now(),
    objectId,
    previousPosition,
    newPosition,
  }
}

export function overrideSet(
  edgeKey: EdgeKey,
  previousClassification: EdgeClassification | null,
  newClassification: EdgeClassification
): OverrideSetCommand {
  return {
    id: generateId(),
    type: 'override:set',
    timestamp: Date.now(),
    edgeKey,
    previousClassification,
    newClassification,
  }
}

export function overrideClear(
  edgeKey: EdgeKey,
  previousClassification: EdgeClassification
): OverrideClearCommand {
  return {
    id: generateId(),
    type: 'override:clear',
    timestamp: Date.now(),
    edgeKey,
    previousClassification,
  }
}

export function batch(commands: AnyCommand[]): BatchCommand {
  return {
    id: generateId(),
    type: 'batch',
    timestamp: Date.now(),
    commands,
  }
}

/**
 * Command Log Types
 *
 * Invertible command system for undo/redo that tracks ALL state changes:
 * objects, floor cells, stairs, and edge overrides.
 * Multiplayer-ready with userId and operationId fields.
 */

import type { VoxelObject, VoxelPosition, StairSide } from './voxel'
import type { EdgeClassification, EdgeKey } from './worldModel'

/**
 * All supported command types.
 */
export type CommandType =
  | 'cell:set-height'
  | 'cell:clear'
  | 'stair:add'
  | 'stair:remove'
  | 'object:add'
  | 'object:update'
  | 'object:remove'
  | 'object:move'
  | 'override:set'
  | 'override:clear'
  | 'batch'

/**
 * Base command interface. All commands are immutable and serializable.
 */
interface CommandBase {
  readonly id: string
  readonly type: CommandType
  readonly timestamp: number
  readonly userId?: string
  readonly operationId?: string
}

export interface CellSetHeightCommand extends CommandBase {
  readonly type: 'cell:set-height'
  readonly x: number
  readonly z: number
  readonly previousHeight: number
  readonly newHeight: number
}

export interface CellClearCommand extends CommandBase {
  readonly type: 'cell:clear'
  readonly x: number
  readonly z: number
  readonly previousHeight: number
}

export interface StairAddCommand extends CommandBase {
  readonly type: 'stair:add'
  readonly x: number
  readonly z: number
  readonly level: number
  readonly side: StairSide
}

export interface StairRemoveCommand extends CommandBase {
  readonly type: 'stair:remove'
  readonly x: number
  readonly z: number
  readonly level: number
  readonly side: StairSide
}

export interface ObjectAddCommand extends CommandBase {
  readonly type: 'object:add'
  readonly object: VoxelObject
}

export interface ObjectUpdateCommand extends CommandBase {
  readonly type: 'object:update'
  readonly objectId: string
  readonly previousState: Partial<VoxelObject>
  readonly newState: Partial<VoxelObject>
}

export interface ObjectRemoveCommand extends CommandBase {
  readonly type: 'object:remove'
  readonly object: VoxelObject
}

export interface ObjectMoveCommand extends CommandBase {
  readonly type: 'object:move'
  readonly objectId: string
  readonly previousPosition: VoxelPosition
  readonly newPosition: VoxelPosition
}

export interface OverrideSetCommand extends CommandBase {
  readonly type: 'override:set'
  readonly edgeKey: EdgeKey
  readonly previousClassification: EdgeClassification | null
  readonly newClassification: EdgeClassification
}

export interface OverrideClearCommand extends CommandBase {
  readonly type: 'override:clear'
  readonly edgeKey: EdgeKey
  readonly previousClassification: EdgeClassification
}

export interface BatchCommand extends CommandBase {
  readonly type: 'batch'
  readonly commands: ReadonlyArray<AnyCommand>
}

/**
 * Union of all command types.
 */
export type AnyCommand =
  | CellSetHeightCommand
  | CellClearCommand
  | StairAddCommand
  | StairRemoveCommand
  | ObjectAddCommand
  | ObjectUpdateCommand
  | ObjectRemoveCommand
  | ObjectMoveCommand
  | OverrideSetCommand
  | OverrideClearCommand
  | BatchCommand

/**
 * State of the command log.
 */
export interface CommandLogState {
  readonly commands: ReadonlyArray<AnyCommand>
  readonly currentIndex: number
  readonly maxCommands: number
}

/**
 * Default max commands for the log.
 */
export const DEFAULT_MAX_COMMANDS = 200

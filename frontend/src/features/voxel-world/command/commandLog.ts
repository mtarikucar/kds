/**
 * Command Log
 *
 * Manages the command history stack for undo/redo operations.
 * All functions are pure (return new state, never mutate).
 */

import type { AnyCommand, CommandLogState } from '../types/commandLog'
import { DEFAULT_MAX_COMMANDS } from '../types/commandLog'

/**
 * Create a new empty command log.
 */
export function createCommandLog(
  maxCommands: number = DEFAULT_MAX_COMMANDS
): CommandLogState {
  return {
    commands: [],
    currentIndex: -1,
    maxCommands,
  }
}

/**
 * Append a command to the log.
 * Truncates any commands after currentIndex (invalidates redo stack).
 * Trims oldest commands if exceeding maxCommands.
 */
export function appendCommand(
  state: CommandLogState,
  command: AnyCommand
): CommandLogState {
  const trimmed = state.commands.slice(0, state.currentIndex + 1)
  const newCommands = [...trimmed, command]

  if (newCommands.length > state.maxCommands) {
    const overflow = newCommands.length - state.maxCommands
    return {
      ...state,
      commands: newCommands.slice(overflow),
      currentIndex: state.maxCommands - 1,
    }
  }

  return {
    ...state,
    commands: newCommands,
    currentIndex: newCommands.length - 1,
  }
}

/**
 * Get the command to undo (the command at currentIndex).
 * Returns null if nothing to undo.
 */
export function getUndoCommand(state: CommandLogState): AnyCommand | null {
  if (state.currentIndex < 0) return null
  return state.commands[state.currentIndex]
}

/**
 * Get the command to redo (the command after currentIndex).
 * Returns null if nothing to redo.
 */
export function getRedoCommand(state: CommandLogState): AnyCommand | null {
  if (state.currentIndex >= state.commands.length - 1) return null
  return state.commands[state.currentIndex + 1]
}

/**
 * Move the index back by one (after applying an undo).
 */
export function stepBack(state: CommandLogState): CommandLogState {
  if (state.currentIndex < 0) return state
  return {
    ...state,
    currentIndex: state.currentIndex - 1,
  }
}

/**
 * Move the index forward by one (after applying a redo).
 */
export function stepForward(state: CommandLogState): CommandLogState {
  if (state.currentIndex >= state.commands.length - 1) return state
  return {
    ...state,
    currentIndex: state.currentIndex + 1,
  }
}

/**
 * Check if undo is available.
 */
export function canUndo(state: CommandLogState): boolean {
  return state.currentIndex >= 0
}

/**
 * Check if redo is available.
 */
export function canRedo(state: CommandLogState): boolean {
  return state.currentIndex < state.commands.length - 1
}

/**
 * Clear the entire command log.
 */
export function clearCommandLog(state: CommandLogState): CommandLogState {
  return {
    ...state,
    commands: [],
    currentIndex: -1,
  }
}

/**
 * Get the number of commands in the log.
 */
export function getCommandCount(state: CommandLogState): number {
  return state.commands.length
}

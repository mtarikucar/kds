/**
 * useCommandLog Hook
 *
 * Provides command-based undo/redo operations.
 * Wraps the command log and executor into a React-friendly API.
 */

import { useCallback, useRef } from 'react'
import type { AnyCommand, CommandLogState } from '../types/commandLog'
import {
  createCommandLog,
  appendCommand,
  getUndoCommand,
  getRedoCommand,
  stepBack,
  stepForward,
  canUndo as checkCanUndo,
  canRedo as checkCanRedo,
  clearCommandLog,
} from '../command/commandLog'
import { applyCommand, invertCommand, type WorldStateSnapshot } from '../command/commandExecutor'

export interface UseCommandLogResult {
  dispatch: (command: AnyCommand, currentState: WorldStateSnapshot) => WorldStateSnapshot
  undo: (currentState: WorldStateSnapshot) => WorldStateSnapshot | null
  redo: (currentState: WorldStateSnapshot) => WorldStateSnapshot | null
  canUndo: boolean
  canRedo: boolean
  clear: () => void
  commandCount: number
}

/**
 * Hook for managing the command log.
 *
 * The command log is maintained as a ref to avoid unnecessary re-renders.
 * The hook provides dispatch/undo/redo that return new world state snapshots.
 */
export function useCommandLog(maxCommands?: number): UseCommandLogResult {
  const logRef = useRef<CommandLogState>(createCommandLog(maxCommands))

  const dispatch = useCallback(
    (command: AnyCommand, currentState: WorldStateSnapshot): WorldStateSnapshot => {
      const newState = applyCommand(currentState, command)
      logRef.current = appendCommand(logRef.current, command)
      return newState
    },
    []
  )

  const undo = useCallback(
    (currentState: WorldStateSnapshot): WorldStateSnapshot | null => {
      const command = getUndoCommand(logRef.current)
      if (!command) return null
      const newState = invertCommand(currentState, command)
      logRef.current = stepBack(logRef.current)
      return newState
    },
    []
  )

  const redo = useCallback(
    (currentState: WorldStateSnapshot): WorldStateSnapshot | null => {
      const command = getRedoCommand(logRef.current)
      if (!command) return null
      const newState = applyCommand(currentState, command)
      logRef.current = stepForward(logRef.current)
      return newState
    },
    []
  )

  const clear = useCallback(() => {
    logRef.current = clearCommandLog(logRef.current)
  }, [])

  return {
    dispatch,
    undo,
    redo,
    canUndo: checkCanUndo(logRef.current),
    canRedo: checkCanRedo(logRef.current),
    clear,
    commandCount: logRef.current.commands.length,
  }
}

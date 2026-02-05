import type { VoxelObject } from '../types/voxel'

export interface HistoryState {
  objects: VoxelObject[]
  timestamp: number
}

export interface HistoryManager {
  states: HistoryState[]
  currentIndex: number
  maxStates: number
}

export const createHistoryManager = (maxStates: number = 50): HistoryManager => ({
  states: [],
  currentIndex: -1,
  maxStates,
})

export const pushState = (
  manager: HistoryManager,
  objects: VoxelObject[]
): HistoryManager => {
  // Create a deep copy of objects to prevent mutation
  const newState: HistoryState = {
    objects: objects.map((obj) => ({
      ...obj,
      position: { ...obj.position },
      rotation: { ...obj.rotation },
      metadata: obj.metadata ? { ...obj.metadata } : undefined,
    })),
    timestamp: Date.now(),
  }

  // Remove any states after current index (when undoing and then making a new change)
  const newStates = manager.states.slice(0, manager.currentIndex + 1)
  newStates.push(newState)

  // Limit the number of states
  if (newStates.length > manager.maxStates) {
    newStates.shift()
  }

  return {
    ...manager,
    states: newStates,
    currentIndex: Math.min(newStates.length - 1, manager.maxStates - 1),
  }
}

export const undo = (manager: HistoryManager): { manager: HistoryManager; objects: VoxelObject[] | null } => {
  if (manager.currentIndex <= 0) {
    return { manager, objects: null }
  }

  const newIndex = manager.currentIndex - 1
  const previousState = manager.states[newIndex]

  return {
    manager: {
      ...manager,
      currentIndex: newIndex,
    },
    objects: previousState.objects.map((obj) => ({
      ...obj,
      position: { ...obj.position },
      rotation: { ...obj.rotation },
      metadata: obj.metadata ? { ...obj.metadata } : undefined,
    })),
  }
}

export const redo = (manager: HistoryManager): { manager: HistoryManager; objects: VoxelObject[] | null } => {
  if (manager.currentIndex >= manager.states.length - 1) {
    return { manager, objects: null }
  }

  const newIndex = manager.currentIndex + 1
  const nextState = manager.states[newIndex]

  return {
    manager: {
      ...manager,
      currentIndex: newIndex,
    },
    objects: nextState.objects.map((obj) => ({
      ...obj,
      position: { ...obj.position },
      rotation: { ...obj.rotation },
      metadata: obj.metadata ? { ...obj.metadata } : undefined,
    })),
  }
}

export const canUndo = (manager: HistoryManager): boolean => manager.currentIndex > 0

export const canRedo = (manager: HistoryManager): boolean =>
  manager.currentIndex < manager.states.length - 1

export const clearHistory = (manager: HistoryManager): HistoryManager => ({
  ...manager,
  states: [],
  currentIndex: -1,
})

export const getHistoryLength = (manager: HistoryManager): number => manager.states.length

export const getCurrentIndex = (manager: HistoryManager): number => manager.currentIndex

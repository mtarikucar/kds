import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { TableStatus } from '@/types'
import type {
  VoxelStore,
  VoxelObject,
  VoxelPosition,
  RestaurantLayout,
  EditorTool,
  VoxelTable,
  StoryPhase,
  MascotAnimation,
  ManipulationState,
  ManipulationMode,
  HandleId,
  SnapConfig,
  SnapGuide,
  StairSegment,
  StairSide,
} from '../types/voxel'
import {
  DEFAULT_CAMERA_POSITION,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_WORLD_DIMENSIONS,
} from '../types/voxel'
import type { EdgeClassification } from '../types/worldModel'
import type { StructuralRule } from '../types/ruleEngine'
import { DEFAULT_RULES } from '../engine/rules'
import { getSampleLayout } from '../data/sampleLayouts'
import { autoArrange } from '../utils/placementEngine'
import {
  createHistoryManager,
  pushState,
  undo as historyUndo,
  redo as historyRedo,
  canUndo as historyCanUndo,
  canRedo as historyCanRedo,
  clearHistory as historyClear,
  type HistoryManager,
} from '../utils/historyManager'
import {
  generateDefaultFloor,
  MAX_BUILDING_HEIGHT,
  cellKey,
} from '../utils/procedural/floorCellManager'

// Utility function to generate stair keys
function stairKey(x: number, z: number, level: number, side: StairSide): string {
  return `${x},${z},${level},${side}`
}

// Remove all stairs associated with a given floor cell
function removeStairsAtCell(stairs: Map<string, StairSegment>, x: number, z: number): Map<string, StairSegment> {
  const prefix = `${x},${z},`
  let changed = false
  const newStairs = new Map(stairs)
  for (const key of stairs.keys()) {
    if (key.startsWith(prefix)) {
      newStairs.delete(key)
      changed = true
    }
  }
  return changed ? newStairs : stairs
}

// Default manipulation state
const DEFAULT_MANIPULATION_STATE: ManipulationState = {
  mode: 'none',
  activeHandle: null,
  ghostPreview: null,
  startPosition: null,
  startSize: null,
}

// Default snap configuration
const DEFAULT_SNAP_CONFIG: SnapConfig = {
  gridSize: 0.5,
  edgeThreshold: 0.3,
  enabled: true,
  showGuides: true,
}

// History manager instance (not persisted)
let historyManager: HistoryManager = createHistoryManager(50)

const createDefaultLayout = (): RestaurantLayout => ({
  id: 'default',
  tenantId: '',
  name: 'Main Floor',
  dimensions: DEFAULT_WORLD_DIMENSIONS,
  objects: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

export const useVoxelStore = create<VoxelStore>()(
  persist(
    (set, get) => ({
      // State
      layout: null,
      selectedObjectId: null,
      hoveredObjectId: null,
      editorTool: 'select',
      isEditorMode: false,
      isDragging: false,
      cameraPosition: DEFAULT_CAMERA_POSITION,
      cameraZoom: DEFAULT_CAMERA_ZOOM,
      // Procedural floor cells (Townscaper-style) - value is height
      floorCells: generateDefaultFloor(),
      // Procedural stairs (manual placement)
      stairs: new Map<string, StairSegment>(),
      // Story mode state
      storyPhase: 'exterior' as const,
      dialogueIndex: 0,
      mascotAnimation: 'idle' as const,
      // History state
      historyIndex: -1,
      historyLength: 0,
      canUndo: false,
      canRedo: false,
      // Manipulation state
      manipulation: DEFAULT_MANIPULATION_STATE,
      snapConfig: DEFAULT_SNAP_CONFIG,
      snapGuides: [],
      // Wall visibility state (kept for backwards compatibility)
      wallVisibility: {
        back: true,
        right: true,
        front: false,
        left: false,
      },
      // Edge overrides (user-placed doors/windows)
      overrides: new Map<string, EdgeClassification>(),
      // Rule engine configuration
      rules: DEFAULT_RULES as ReadonlyArray<StructuralRule>,
      enablePatternMatching: true,

      // Layout actions
      setLayout: (layout: RestaurantLayout) =>
        set({ layout }),

      // Selection actions
      selectObject: (id: string | null) =>
        set({ selectedObjectId: id }),

      hoverObject: (id: string | null) =>
        set({ hoveredObjectId: id }),

      // Editor actions
      setEditorTool: (tool: EditorTool) =>
        set({ editorTool: tool }),

      toggleEditorMode: () =>
        set((state) => ({
          isEditorMode: !state.isEditorMode,
          selectedObjectId: null,
          editorTool: 'select',
        })),

      setDragging: (isDragging: boolean) =>
        set({ isDragging }),

      // Object manipulation
      addObject: (object: VoxelObject) =>
        set((state) => {
          if (!state.layout) {
            const newLayout = createDefaultLayout()
            return {
              layout: {
                ...newLayout,
                objects: [object],
                updatedAt: new Date().toISOString(),
              },
            }
          }
          return {
            layout: {
              ...state.layout,
              objects: [...state.layout.objects, object],
              updatedAt: new Date().toISOString(),
            },
          }
        }),

      updateObject: (id: string, updates: Partial<VoxelObject>) =>
        set((state) => {
          if (!state.layout) return state
          return {
            layout: {
              ...state.layout,
              objects: state.layout.objects.map((obj) =>
                obj.id === id ? { ...obj, ...updates } : obj
              ),
              updatedAt: new Date().toISOString(),
            },
          }
        }),

      removeObject: (id: string) =>
        set((state) => {
          if (!state.layout) return state
          return {
            layout: {
              ...state.layout,
              objects: state.layout.objects.filter((obj) => obj.id !== id),
              updatedAt: new Date().toISOString(),
            },
            selectedObjectId:
              state.selectedObjectId === id ? null : state.selectedObjectId,
          }
        }),

      moveObject: (id: string, position: VoxelPosition) =>
        set((state) => {
          if (!state.layout) return state
          return {
            layout: {
              ...state.layout,
              objects: state.layout.objects.map((obj) =>
                obj.id === id
                  ? { ...obj, position }
                  : obj
              ),
              updatedAt: new Date().toISOString(),
            },
          }
        }),

      rotateObject: (id: string) =>
        set((state) => {
          if (!state.layout) return state
          return {
            layout: {
              ...state.layout,
              objects: state.layout.objects.map((obj) => {
                if (obj.id !== id) return obj
                const newRotation = (obj.rotation.y + 90) % 360
                return {
                  ...obj,
                  rotation: { y: newRotation },
                }
              }),
              updatedAt: new Date().toISOString(),
            },
          }
        }),

      setObjectRotation: (id: string, rotation: number) =>
        set((state) => {
          if (!state.layout) return state
          const normalizedRotation = ((rotation % 360) + 360) % 360
          return {
            layout: {
              ...state.layout,
              objects: state.layout.objects.map((obj) =>
                obj.id === id
                  ? { ...obj, rotation: { y: normalizedRotation } }
                  : obj
              ),
              updatedAt: new Date().toISOString(),
            },
          }
        }),

      // Table-specific actions
      updateTableStatus: (tableId: string, status: TableStatus) =>
        set((state) => {
          if (!state.layout) return state
          return {
            layout: {
              ...state.layout,
              objects: state.layout.objects.map((obj) => {
                if (obj.type !== 'table') return obj
                const tableObj = obj as VoxelTable
                if (tableObj.linkedTableId !== tableId) return obj
                return { ...tableObj, status }
              }),
              updatedAt: new Date().toISOString(),
            },
          }
        }),

      removeTableFromLayout: (linkedTableId: string) =>
        set((state) => {
          if (!state.layout) return state
          // Find the voxel table with the given linkedTableId
          const tableToRemove = state.layout.objects.find(
            (obj) => obj.type === 'table' && (obj as VoxelTable).linkedTableId === linkedTableId
          )
          if (!tableToRemove) return state
          return {
            layout: {
              ...state.layout,
              objects: state.layout.objects.filter((obj) => obj.id !== tableToRemove.id),
              updatedAt: new Date().toISOString(),
            },
            selectedObjectId:
              state.selectedObjectId === tableToRemove.id ? null : state.selectedObjectId,
          }
        }),

      // Camera actions
      setCameraPosition: (position: VoxelPosition) =>
        set({ cameraPosition: position }),

      setCameraZoom: (zoom: number) =>
        set({ cameraZoom: Math.max(0.1, Math.min(5, zoom)) }),

      // Layout management actions
      loadSampleLayout: () =>
        set((state) => {
          const sample = getSampleLayout()
          const currentLayout = state.layout ?? createDefaultLayout()
          return {
            layout: {
              ...currentLayout,
              objects: sample.objects,
              updatedAt: new Date().toISOString(),
            },
          }
        }),

      clearAllObjects: () =>
        set((state) => {
          if (!state.layout) return state
          return {
            layout: {
              ...state.layout,
              objects: [],
              updatedAt: new Date().toISOString(),
            },
            selectedObjectId: null,
          }
        }),

      autoArrangeObjects: () =>
        set((state) => {
          if (!state.layout || state.layout.objects.length === 0) return state
          const arranged = autoArrange(
            state.layout.objects,
            state.layout.dimensions,
          )
          return {
            layout: {
              ...state.layout,
              objects: arranged,
              updatedAt: new Date().toISOString(),
            },
          }
        }),

      setLayoutDimensions: (width: number, depth: number, height?: number) =>
        set((state) => {
          // Clamp values to valid range
          const clampedWidth = Math.max(16, Math.min(64, width))
          const clampedDepth = Math.max(16, Math.min(64, depth))

          const currentLayout = state.layout ?? createDefaultLayout()
          const clampedHeight = height !== undefined
            ? Math.max(3, Math.min(16, height))
            : currentLayout.dimensions.height

          const newDimensions = {
            width: clampedWidth,
            height: clampedHeight,
            depth: clampedDepth,
          }

          // Filter out objects that would be outside new bounds
          const filteredObjects = currentLayout.objects.filter((obj) => {
            const objWidth = obj.metadata?.width as number ?? 1
            const objDepth = obj.metadata?.depth as number ?? 1
            return (
              obj.position.x >= 0 &&
              obj.position.x + objWidth <= clampedWidth &&
              obj.position.z >= 0 &&
              obj.position.z + objDepth <= clampedDepth
            )
          })

          return {
            layout: {
              ...currentLayout,
              dimensions: newDimensions,
              objects: filteredObjects,
              updatedAt: new Date().toISOString(),
            },
            // Deselect if selected object was removed
            selectedObjectId: filteredObjects.some(
              (obj) => obj.id === state.selectedObjectId
            )
              ? state.selectedObjectId
              : null,
          }
        }),

      // Procedural floor cell actions (Townscaper-style)
      // Left click: increment height (add level)
      incrementFloorHeight: (x: number, z: number) =>
        set((state) => {
          const key = cellKey(x, z)
          const newCells = new Map(state.floorCells)
          const currentHeight = newCells.get(key) ?? 0
          if (currentHeight < MAX_BUILDING_HEIGHT) {
            newCells.set(key, currentHeight + 1)
          }
          return { floorCells: newCells }
        }),

      // Right click: decrement height (remove level)
      decrementFloorHeight: (x: number, z: number) =>
        set((state) => {
          const key = cellKey(x, z)
          const newCells = new Map(state.floorCells)
          const currentHeight = newCells.get(key) ?? 0
          if (currentHeight > 1) {
            newCells.set(key, currentHeight - 1)
          } else {
            newCells.delete(key)
          }
          return { floorCells: newCells }
        }),

      // Legacy toggle - kept for compatibility, increments if 0, otherwise removes
      toggleFloorCell: (x: number, z: number) =>
        set((state) => {
          const key = cellKey(x, z)
          const newCells = new Map(state.floorCells)
          const currentHeight = newCells.get(key) ?? 0
          if (currentHeight > 0) {
            newCells.delete(key)
            // Clean up stairs on this cell
            const newStairs = removeStairsAtCell(state.stairs, x, z)
            return { floorCells: newCells, stairs: newStairs }
          } else {
            newCells.set(key, 1)
            return { floorCells: newCells }
          }
        }),

      setFloorCell: (x: number, z: number, active: boolean) =>
        set((state) => {
          const key = cellKey(x, z)
          const newCells = new Map(state.floorCells)
          if (active) {
            const currentHeight = newCells.get(key) ?? 0
            if (currentHeight === 0) {
              newCells.set(key, 1)
            }
            return { floorCells: newCells }
          } else {
            newCells.delete(key)
            // Clean up stairs on this cell
            const newStairs = removeStairsAtCell(state.stairs, x, z)
            return { floorCells: newCells, stairs: newStairs }
          }
        }),

      setFloorHeight: (x: number, z: number, height: number) =>
        set((state) => {
          const key = cellKey(x, z)
          const newCells = new Map(state.floorCells)
          const clampedHeight = Math.max(0, Math.min(MAX_BUILDING_HEIGHT, height))
          if (clampedHeight > 0) {
            newCells.set(key, clampedHeight)
          } else {
            newCells.delete(key)
          }
          return { floorCells: newCells }
        }),

      clearAllFloor: () =>
        set({ floorCells: new Map<string, number>() }),

      resetFloorToDefault: () =>
        set({ floorCells: generateDefaultFloor() }),

      setFloorCells: (cells: Map<string, number>) =>
        set({ floorCells: new Map(cells) }),

      // Procedural stairs actions
      addStair: (x: number, z: number, level: number, side: StairSide) =>
        set((state) => {
          const key = stairKey(x, z, level, side)
          const newStairs = new Map(state.stairs)
          const stair: StairSegment = {
            id: key,
            x,
            z,
            level,
            side,
            steps: 4, // Default 4 steps per level
          }
          newStairs.set(key, stair)
          return { stairs: newStairs }
        }),

      removeStair: (x: number, z: number, level: number, side: StairSide) =>
        set((state) => {
          const key = stairKey(x, z, level, side)
          const newStairs = new Map(state.stairs)
          newStairs.delete(key)
          return { stairs: newStairs }
        }),

      toggleStair: (x: number, z: number, level: number, side: StairSide) =>
        set((state) => {
          const key = stairKey(x, z, level, side)
          const newStairs = new Map(state.stairs)
          if (newStairs.has(key)) {
            newStairs.delete(key)
          } else {
            const stair: StairSegment = {
              id: key,
              x,
              z,
              level,
              side,
              steps: 4,
            }
            newStairs.set(key, stair)
          }
          return { stairs: newStairs }
        }),

      clearAllStairs: () =>
        set({ stairs: new Map<string, StairSegment>() }),

      // Story mode actions
      setStoryPhase: (phase) =>
        set({ storyPhase: phase }),

      nextDialogue: () =>
        set((state) => ({
          dialogueIndex: state.dialogueIndex + 1,
        })),

      resetDialogue: () =>
        set({ dialogueIndex: 0 }),

      setMascotAnimation: (animation) =>
        set({ mascotAnimation: animation }),

      // History actions (undo/redo)
      undo: () => {
        const result = historyUndo(historyManager)
        if (result.objects) {
          historyManager = result.manager
          set((state) => {
            if (!state.layout) return state
            return {
              layout: {
                ...state.layout,
                objects: result.objects!,
                updatedAt: new Date().toISOString(),
              },
              historyIndex: historyManager.currentIndex,
              canUndo: historyCanUndo(historyManager),
              canRedo: historyCanRedo(historyManager),
            }
          })
        }
      },

      redo: () => {
        const result = historyRedo(historyManager)
        if (result.objects) {
          historyManager = result.manager
          set((state) => {
            if (!state.layout) return state
            return {
              layout: {
                ...state.layout,
                objects: result.objects!,
                updatedAt: new Date().toISOString(),
              },
              historyIndex: historyManager.currentIndex,
              canUndo: historyCanUndo(historyManager),
              canRedo: historyCanRedo(historyManager),
            }
          })
        }
      },

      pushHistory: () => {
        const state = get()
        if (state.layout) {
          historyManager = pushState(historyManager, state.layout.objects)
          set({
            historyIndex: historyManager.currentIndex,
            historyLength: historyManager.states.length,
            canUndo: historyCanUndo(historyManager),
            canRedo: historyCanRedo(historyManager),
          })
        }
      },

      clearHistory: () => {
        historyManager = historyClear(historyManager)
        set({
          historyIndex: -1,
          historyLength: 0,
          canUndo: false,
          canRedo: false,
        })
      },

      // Manipulation actions (TinyGlade-style)
      setManipulationMode: (mode: ManipulationMode) =>
        set((state) => ({
          manipulation: { ...state.manipulation, mode },
        })),

      setActiveHandle: (handle: HandleId | null) =>
        set((state) => ({
          manipulation: { ...state.manipulation, activeHandle: handle },
        })),

      setGhostPreview: (preview: VoxelObject | null) =>
        set((state) => ({
          manipulation: { ...state.manipulation, ghostPreview: preview },
        })),

      startManipulation: (position: VoxelPosition, size?: { width: number; depth: number }) =>
        set((state) => ({
          manipulation: {
            ...state.manipulation,
            startPosition: position,
            startSize: size ?? null,
          },
        })),

      endManipulation: () =>
        set({
          manipulation: DEFAULT_MANIPULATION_STATE,
        }),

      resizeObject: (id: string, newSize: { width: number; depth: number }) =>
        set((state) => {
          if (!state.layout) return state
          return {
            layout: {
              ...state.layout,
              objects: state.layout.objects.map((obj) =>
                obj.id === id
                  ? {
                      ...obj,
                      metadata: {
                        ...obj.metadata,
                        width: newSize.width,
                        depth: newSize.depth,
                      },
                    }
                  : obj
              ),
              updatedAt: new Date().toISOString(),
            },
          }
        }),

      // Snap configuration
      setSnapConfig: (config: Partial<SnapConfig>) =>
        set((state) => ({
          snapConfig: { ...state.snapConfig, ...config },
        })),

      toggleSnap: () =>
        set((state) => ({
          snapConfig: { ...state.snapConfig, enabled: !state.snapConfig.enabled },
        })),

      setSnapGuides: (guides: SnapGuide[]) =>
        set({ snapGuides: guides }),

      // Edge override actions
      setEdgeOverride: (edgeKey: string, classification: EdgeClassification) =>
        set((state) => {
          const newOverrides = new Map(state.overrides)
          newOverrides.set(edgeKey, classification)
          return { overrides: newOverrides }
        }),

      clearEdgeOverride: (edgeKey: string) =>
        set((state) => {
          const newOverrides = new Map(state.overrides)
          newOverrides.delete(edgeKey)
          return { overrides: newOverrides }
        }),

      clearAllOverrides: () =>
        set({ overrides: new Map<string, EdgeClassification>() }),

      // Rule engine actions
      setRules: (rules: ReadonlyArray<StructuralRule>) =>
        set({ rules }),

      setEnablePatternMatching: (enabled: boolean) =>
        set({ enablePatternMatching: enabled }),

      // Wall visibility actions
      toggleWall: (wall: 'back' | 'right' | 'front' | 'left') =>
        set((state) => ({
          wallVisibility: {
            ...state.wallVisibility,
            [wall]: !state.wallVisibility[wall],
          },
        })),
    }),
    {
      name: 'voxel-world-storage',
      partialize: (state) => ({
        layout: state.layout,
        cameraPosition: state.cameraPosition,
        cameraZoom: state.cameraZoom,
        // Convert Map to array for JSON serialization (now stores height values)
        floorCellsArray: Array.from(state.floorCells.entries()),
        // Persist stairs as array
        stairsArray: Array.from(state.stairs.entries()),
        // Persist edge overrides as array
        overridesArray: Array.from(state.overrides.entries()),
      }),
      merge: (persistedState: unknown, currentState: VoxelStore) => {
        const persisted = persistedState as Partial<VoxelStore> & {
          floorCellsArray?: Array<[string, number | boolean]>
          stairsArray?: Array<[string, StairSegment]>
          overridesArray?: Array<[string, EdgeClassification]>
        }
        let floorCells = currentState.floorCells
        let stairs = currentState.stairs
        let overrides = currentState.overrides

        if (persisted.floorCellsArray) {
          // Convert old boolean format to new height format if needed
          floorCells = new Map<string, number>()
          for (const [key, value] of persisted.floorCellsArray) {
            if (typeof value === 'boolean') {
              // Old format: boolean -> convert to height 1
              if (value) floorCells.set(key, 1)
            } else {
              // New format: number (height)
              if (value > 0) floorCells.set(key, value)
            }
          }
        }

        if (persisted.stairsArray) {
          stairs = new Map<string, StairSegment>(persisted.stairsArray)
        }

        if (persisted.overridesArray) {
          overrides = new Map<string, EdgeClassification>(persisted.overridesArray)
        }

        return {
          ...currentState,
          ...persisted,
          floorCells,
          stairs,
          overrides,
        }
      },
    }
  )
)

// Selectors
export const selectLayout = (state: VoxelStore) => state.layout
export const selectObjects = (state: VoxelStore) => state.layout?.objects ?? []
export const selectTables = (state: VoxelStore) =>
  (state.layout?.objects ?? []).filter(
    (obj): obj is VoxelTable => obj.type === 'table'
  )
export const selectSelectedObject = (state: VoxelStore) => {
  if (!state.selectedObjectId || !state.layout) return null
  return state.layout.objects.find((obj) => obj.id === state.selectedObjectId)
}
export const selectIsEditorMode = (state: VoxelStore) => state.isEditorMode
export const selectEditorTool = (state: VoxelStore) => state.editorTool
export const selectFloorCells = (state: VoxelStore) => state.floorCells
export const selectStairs = (state: VoxelStore) => state.stairs
export const selectOverrides = (state: VoxelStore) => state.overrides
export const selectRules = (state: VoxelStore) => state.rules
export const selectEnablePatternMatching = (state: VoxelStore) => state.enablePatternMatching

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
} from '../types/voxel'
import {
  DEFAULT_CAMERA_POSITION,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_WORLD_DIMENSIONS,
} from '../types/voxel'
import { getSampleLayout } from '../data/sampleLayouts'
import { autoArrange } from '../utils/placementEngine'

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
      // Story mode state
      storyPhase: 'exterior' as const,
      dialogueIndex: 0,
      mascotAnimation: 'idle' as const,

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

      resetCamera: () =>
        set({
          cameraPosition: DEFAULT_CAMERA_POSITION,
          cameraZoom: DEFAULT_CAMERA_ZOOM,
        }),

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

      setLayoutDimensions: (width: number, depth: number) =>
        set((state) => {
          // Clamp values to valid range
          const clampedWidth = Math.max(16, Math.min(64, width))
          const clampedDepth = Math.max(16, Math.min(64, depth))

          const currentLayout = state.layout ?? createDefaultLayout()
          const newDimensions = {
            width: clampedWidth,
            height: currentLayout.dimensions.height,
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
    }),
    {
      name: 'voxel-world-storage',
      partialize: (state) => ({
        layout: state.layout,
        cameraPosition: state.cameraPosition,
        cameraZoom: state.cameraZoom,
      }),
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

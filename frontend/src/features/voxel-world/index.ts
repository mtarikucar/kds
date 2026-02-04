// Components
export { VoxelCanvas } from './components/VoxelCanvas'
export { VoxelWorld } from './components/VoxelWorld'
export { VoxelWorldView } from './components/VoxelWorldView'
export { VoxelFloor } from './components/VoxelFloor'
export { VoxelWalls } from './components/VoxelWalls'
export { OrbitCamera } from './components/camera/OrbitCamera'
export { HeatmapOverlay, createHeatmapFromPoints, createOccupancyHeatmap } from './components/HeatmapOverlay'
export type { HeatmapOverlayProps, HeatmapColorScheme } from './components/HeatmapOverlay'

// Editor
export { EditorToolbar } from './components/editor/EditorToolbar'
export { ObjectLibrary } from './components/editor/ObjectLibrary'

// Map 2D
export { Map2DView, Map2DCanvas, Map2DObject as Map2DObjectComponent, Map2DToolbar, Map2DObjectProperties } from './components/map-2d'

// POS Floor Plan
export { POSFloorPlanView, POSMap2DView, POSMap2DTable } from './components/pos'

// Mini Maps
export { MiniMap2D, MiniMap3D } from './components/mini-maps'

// Objects
export { VoxelTableObject } from './components/objects/VoxelTable'
export { VoxelChair } from './components/objects/VoxelChair'
export { VoxelKitchen } from './components/objects/VoxelKitchen'
export { VoxelBar } from './components/objects/VoxelBar'
export { VoxelDecor } from './components/objects/VoxelDecor'
export { VoxelModelObject } from './components/objects/VoxelModelObject'
export { ModelLoadingPlaceholder } from './components/objects/ModelLoadingPlaceholder'
export { InstancedModels, GroupedInstancedModels, shouldUseInstancing } from './components/objects/InstancedModels'

// Hooks
export { useVoxelWorld } from './hooks/useVoxelWorld'
export { useTablePositionSync } from './hooks/useTablePositionSync'
export { useLayout, useUpdateLayout, useUpdateTablePosition, useTablesWithPositions } from './hooks/useLayoutsApi'
export { useVoxelSocket } from './hooks/useVoxelSocket'
export { useModelLoader, preloadModel, clearModelCache } from './hooks/useModelLoader'
export { useModelAnimation } from './hooks/useModelAnimation'

// Utils
export { serializeLayout, deserializeLayout, compressWorldData, decompressWorldData, calculateLayoutChecksum } from './utils/worldSerializer'
export { getMemoryStats, clearAllCache, preloadModels } from './utils/modelMemoryManager'
export { voxelToMap2D, map2DToVoxelPosition, voxelObjectsToMap2D, snapToGrid, getObjectDimensions } from './utils/map2dAdapter'

// Plugins
export { registerPlugin, unregisterPlugin, getPlugins, getEnabledPlugins, togglePlugin, getPlugin } from './plugins/map2dPlugins'

// Data
export { MODEL_LIBRARY, MODEL_CATEGORIES, getModelsByCategory, getModelById } from './data/modelLibrary'

// Store
export { useVoxelStore } from './store/voxelStore'

// Types
export type {
  VoxelObjectType,
  EditorTool,
  VoxelPosition,
  VoxelRotation,
  VoxelObject,
  VoxelTable,
  WorldDimensions,
  RestaurantLayout,
  VoxelWorldState,
  VoxelWorldActions,
  VoxelStore,
  LibraryItem,
  ModelCategory,
  AnimationConfig,
  ModelConfig,
  VoxelModelObject as VoxelModelObjectType,
  ModelLibraryItem,
} from './types/voxel'

export type {
  AnimationState,
  AnimationControls,
} from './hooks/useModelAnimation'

export type {
  ModelLoadResult,
} from './hooks/useModelLoader'

export {
  VOXEL_COLORS,
  VOXEL_SIZE,
  DEFAULT_WORLD_DIMENSIONS,
  DEFAULT_CAMERA_POSITION,
  DEFAULT_CAMERA_ZOOM,
  FURNITURE_LIBRARY,
} from './types/voxel'

// Map2D Types
export type {
  Map2DConfig,
  Map2DObject,
  Map2DViewState,
  Map2DPlugin,
  Map2DPluginHooks,
  Map2DPluginDefinition,
} from './types/map2d'

export {
  DEFAULT_MAP2D_CONFIG,
  DEFAULT_MAP2D_VIEW_STATE,
  MAP2D_COLORS,
} from './types/map2d'

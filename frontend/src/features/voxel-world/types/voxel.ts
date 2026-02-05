import type { TableStatus } from '@/types'

export type VoxelObjectType =
  | 'table'
  | 'chair'
  | 'kitchen'
  | 'bar'
  | 'decor'
  | 'wall'
  | 'floor'
  | 'door'
  | 'window'
  | 'model'

export type EditorTool = 'select' | 'move' | 'rotate' | 'delete' | 'floor' | 'table' | 'stair'

// Handle system types for TinyGlade-style manipulation
export type HandleId = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'rotate' | 'center'

export type ManipulationMode = 'none' | 'resize' | 'rotate' | 'move'

export interface ManipulationState {
  mode: ManipulationMode
  activeHandle: HandleId | null
  ghostPreview: VoxelObject | null
  startPosition: VoxelPosition | null
  startSize: { width: number; depth: number } | null
}

// Size constraints for resizable objects
export interface SizeConstraints {
  minWidth: number
  maxWidth: number
  minDepth: number
  maxDepth: number
}

// Resizable object interface
export interface ResizableObject extends VoxelObject {
  constraints: SizeConstraints
  currentSize: { width: number; depth: number }
}

// Table variation types
export type TableLegStyle = 'modern' | 'classic' | 'pedestal'
export type TableTopShape = 'square' | 'round' | 'rounded-square'
export type TableMaterial = 'wood-light' | 'wood-dark' | 'metal'

export interface TableVariation {
  legStyle: TableLegStyle
  topShape: TableTopShape
  material: TableMaterial
}

// Snap system configuration
export interface SnapConfig {
  gridSize: number
  edgeThreshold: number
  enabled: boolean
  showGuides: boolean
}

export interface SnapResult {
  position: VoxelPosition
  snappedAxes: { x: boolean; z: boolean }
  guides: SnapGuide[]
}

export interface SnapGuide {
  type: 'grid' | 'edge' | 'center'
  axis: 'x' | 'z'
  position: number
  sourceObjectId?: string
}

// Wall visibility configuration
export interface WallVisibility {
  back: boolean
  right: boolean
  front: boolean
  left: boolean
}

// Stair system types
export type StairSide = 'n' | 's' | 'e' | 'w'

export interface StairSegment {
  id: string
  x: number           // Cell position
  z: number
  level: number       // Lower level (stair connects level to level+1)
  side: StairSide     // Which edge of the cell
  steps: number       // Number of steps (typically 4-5)
}

// Railing system types
export interface RailingSegment {
  id: string
  x: number
  z: number
  level: number       // Which level the railing is on
  side: StairSide     // Which edge
  length: number      // Length in cells (for merged railings)
}

// Story mode types
export type StoryPhase = 'exterior' | 'transition' | 'interior'
export type MascotAnimation = 'idle' | 'bounce' | 'nod'

export interface VoxelPosition {
  x: number
  y: number
  z: number
}

export interface VoxelRotation {
  y: number // Only Y-axis rotation (0, 90, 180, 270)
}

export interface VoxelObject {
  id: string
  type: VoxelObjectType
  position: VoxelPosition
  rotation: VoxelRotation
  linkedTableId?: string // For tables linked to Table entity
  metadata?: Record<string, unknown>
}

export interface VoxelTable extends VoxelObject {
  type: 'table'
  linkedTableId: string
  status: TableStatus
  tableNumber: string
  capacity: number
}

export type ModelCategory = 'furniture' | 'equipment' | 'decoration' | 'custom'

export interface AnimationConfig {
  name: string
  autoPlay?: boolean
  loop?: boolean
  speed?: number
}

export interface ModelConfig {
  modelUrl: string
  scale?: number
  animations?: AnimationConfig[]
  activeAnimation?: string
}

export interface VoxelModelObject extends VoxelObject {
  type: 'model'
  modelConfig: ModelConfig
}

export interface ModelLibraryItem {
  id: string
  name: string
  category: ModelCategory
  modelUrl: string
  thumbnailUrl?: string
  description: string
  defaultScale: number
  dimensions: { width: number; height: number; depth: number }
  animations?: string[]
}

export interface WorldDimensions {
  width: number
  height: number
  depth: number
}

export interface RestaurantLayout {
  id: string
  tenantId: string
  name: string
  dimensions: WorldDimensions
  objects: VoxelObject[]
  createdAt: string
  updatedAt: string
}

export interface VoxelWorldState {
  layout: RestaurantLayout | null
  selectedObjectId: string | null
  hoveredObjectId: string | null
  editorTool: EditorTool
  isEditorMode: boolean
  isDragging: boolean
  cameraPosition: VoxelPosition
  cameraZoom: number
  // Procedural floor cells (Townscaper-style) - value is height (number of levels)
  floorCells: Map<string, number>
  // Procedural stairs - key: "x,z,level,side"
  stairs: Map<string, StairSegment>
  // Story mode state
  storyPhase: StoryPhase
  dialogueIndex: number
  mascotAnimation: MascotAnimation
  // History state (undo/redo)
  historyIndex: number
  historyLength: number
  canUndo: boolean
  canRedo: boolean
  // Manipulation state (TinyGlade-style)
  manipulation: ManipulationState
  snapConfig: SnapConfig
  snapGuides: SnapGuide[]
  // Wall visibility (kept for backwards compatibility)
  wallVisibility: WallVisibility
}

export interface VoxelWorldActions {
  setLayout: (layout: RestaurantLayout) => void
  selectObject: (id: string | null) => void
  hoverObject: (id: string | null) => void
  setEditorTool: (tool: EditorTool) => void
  toggleEditorMode: () => void
  setDragging: (isDragging: boolean) => void

  addObject: (object: VoxelObject) => void
  updateObject: (id: string, updates: Partial<VoxelObject>) => void
  removeObject: (id: string) => void
  moveObject: (id: string, position: VoxelPosition) => void
  rotateObject: (id: string) => void
  setObjectRotation: (id: string, rotation: number) => void

  updateTableStatus: (tableId: string, status: TableStatus) => void
  removeTableFromLayout: (linkedTableId: string) => void

  setCameraPosition: (position: VoxelPosition) => void
  setCameraZoom: (zoom: number) => void
  resetCamera: () => void

  // Layout management actions
  loadSampleLayout: () => void
  clearAllObjects: () => void
  autoArrangeObjects: () => void
  setLayoutDimensions: (width: number, depth: number, height?: number) => void

  // Procedural floor actions (Townscaper-style)
  incrementFloorHeight: (x: number, z: number) => void
  decrementFloorHeight: (x: number, z: number) => void
  toggleFloorCell: (x: number, z: number) => void
  setFloorCell: (x: number, z: number, active: boolean) => void
  setFloorHeight: (x: number, z: number, height: number) => void
  clearAllFloor: () => void
  resetFloorToDefault: () => void
  setFloorCells: (cells: Map<string, number>) => void

  // Procedural stairs actions
  addStair: (x: number, z: number, level: number, side: StairSide) => void
  removeStair: (x: number, z: number, level: number, side: StairSide) => void
  toggleStair: (x: number, z: number, level: number, side: StairSide) => void
  clearAllStairs: () => void

  // Story mode actions
  setStoryPhase: (phase: StoryPhase) => void
  nextDialogue: () => void
  resetDialogue: () => void
  setMascotAnimation: (animation: MascotAnimation) => void

  // History actions (undo/redo)
  undo: () => void
  redo: () => void
  pushHistory: () => void
  clearHistory: () => void

  // Manipulation actions (TinyGlade-style)
  setManipulationMode: (mode: ManipulationMode) => void
  setActiveHandle: (handle: HandleId | null) => void
  setGhostPreview: (preview: VoxelObject | null) => void
  startManipulation: (position: VoxelPosition, size?: { width: number; depth: number }) => void
  endManipulation: () => void
  resizeObject: (id: string, newSize: { width: number; depth: number }) => void

  // Snap configuration
  setSnapConfig: (config: Partial<SnapConfig>) => void
  toggleSnap: () => void
  setSnapGuides: (guides: SnapGuide[]) => void

  // Wall visibility
  toggleWall: (wall: 'back' | 'right' | 'front' | 'left') => void
}

export type VoxelStore = VoxelWorldState & VoxelWorldActions

export const VOXEL_COLORS = {
  floorTile: '#D4A574',
  wallBrick: '#8B4513',
  wallPlaster: '#F5F5DC',
  available: '#10B981',
  occupied: '#EF4444',
  reserved: '#F59E0B',
  tableWood: '#8B4513',
  chairFabric: '#4A5568',
  kitchen: '#6B7280',
  bar: '#92400E',
  selected: '#3B82F6',
  hovered: '#60A5FA',
} as const

export const VOXEL_SIZE = 1 // 1 unit = 1 voxel

export const DEFAULT_WORLD_DIMENSIONS: WorldDimensions = {
  width: 32,
  height: 8,
  depth: 32,
}

export const DEFAULT_CAMERA_POSITION: VoxelPosition = {
  x: 16,
  y: 20,
  z: 32,
}

export const DEFAULT_CAMERA_ZOOM = 1

export interface LibraryItem {
  id: string
  name: string
  type: VoxelObjectType
  icon: string
  dimensions: { width: number; height: number; depth: number }
  description: string
}

export const FURNITURE_LIBRARY: LibraryItem[] = [
  {
    id: 'table-2',
    name: 'Table (2 seats)',
    type: 'table',
    icon: 'table',
    dimensions: { width: 2, height: 1, depth: 2 },
    description: '2-person table',
  },
  {
    id: 'table-4',
    name: 'Table (4 seats)',
    type: 'table',
    icon: 'table',
    dimensions: { width: 3, height: 1, depth: 3 },
    description: '4-person table',
  },
  {
    id: 'table-6',
    name: 'Table (6 seats)',
    type: 'table',
    icon: 'table',
    dimensions: { width: 4, height: 1, depth: 3 },
    description: '6-person table',
  },
  {
    id: 'chair',
    name: 'Chair',
    type: 'chair',
    icon: 'armchair',
    dimensions: { width: 1, height: 1, depth: 1 },
    description: 'Single chair',
  },
  {
    id: 'bar-counter',
    name: 'Bar Counter',
    type: 'bar',
    icon: 'coffee',
    dimensions: { width: 4, height: 1, depth: 1 },
    description: 'Bar counter section',
  },
  {
    id: 'kitchen-station',
    name: 'Kitchen Station',
    type: 'kitchen',
    icon: 'chef-hat',
    dimensions: { width: 3, height: 2, depth: 2 },
    description: 'Kitchen prep area',
  },
  {
    id: 'plant',
    name: 'Plant',
    type: 'decor',
    icon: 'tree-pine',
    dimensions: { width: 1, height: 2, depth: 1 },
    description: 'Decorative plant',
  },
  {
    id: 'door-single',
    name: 'Door',
    type: 'door',
    icon: 'door-open',
    dimensions: { width: 1, height: 2, depth: 1 },
    description: 'Single door',
  },
  {
    id: 'window-standard',
    name: 'Window',
    type: 'window',
    icon: 'square-dashed-bottom',
    dimensions: { width: 1, height: 1, depth: 1 },
    description: 'Standard window',
  },
  {
    id: 'wall-segment',
    name: 'Wall Segment',
    type: 'wall',
    icon: 'square',
    dimensions: { width: 1, height: 3, depth: 1 },
    description: 'Wall section',
  },
]

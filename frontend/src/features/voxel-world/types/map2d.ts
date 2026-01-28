import type { VoxelObjectType } from './voxel'

export interface Map2DConfig {
  width: number
  height: number // depth in 3D (z-axis)
  gridSize: number
  showGrid: boolean
  snapToGrid: boolean
}

export interface Map2DObject {
  id: string
  type: VoxelObjectType
  x: number
  z: number
  width: number
  depth: number
  rotation: number // degrees (0, 90, 180, 270)
  label?: string
  color?: string
  // Dynamic metadata for rendering
  capacity?: number // Table capacity (affects size)
  shape?: 'rectangle' | 'round' | 'oval' | 'L-shaped' // Shape variant
  variant?: string // Object variant (e.g., 'stove', 'sink', 'prep' for kitchen)
  linkedTableId?: string // For tables linked to Table entity
  status?: 'available' | 'occupied' | 'reserved'
}

export interface Map2DViewState {
  scale: number
  offsetX: number
  offsetY: number
}

export const DEFAULT_MAP2D_CONFIG: Map2DConfig = {
  width: 32,
  height: 32,
  gridSize: 1,
  showGrid: true,
  snapToGrid: true,
}

export const DEFAULT_MAP2D_VIEW_STATE: Map2DViewState = {
  scale: 20, // pixels per unit
  offsetX: 0,
  offsetY: 0,
}

export const MAP2D_COLORS: Record<VoxelObjectType, string> = {
  table: '#8B5A2B',
  chair: '#4A5568',
  kitchen: '#718096',
  bar: '#C05621',
  decor: '#48BB78',
  wall: '#2D3748',
  floor: '#D4A574',
  door: '#F6AD55',
  window: '#63B3ED',
  model: '#9333EA',
}

// Professional color palette with additional shades and status colors
export const MAP2D_COLORS_EXTENDED = {
  // Structural
  wall: '#2D3748',
  wallShadow: '#1A202C',
  wallHighlight: '#4A5568',

  // Openings
  door: '#F6AD55',
  doorSwing: 'rgba(246, 173, 85, 0.3)',
  doorFrame: '#C05621',
  window: '#63B3ED',
  windowFrame: '#2B6CB0',
  windowGlass: 'rgba(99, 179, 237, 0.4)',

  // Furniture
  table: '#8B5A2B',
  tableTop: '#A0724B',
  tableShadow: '#5D3A1A',
  chair: '#4A5568',
  chairSeat: '#718096',

  // Areas
  kitchen: '#718096',
  kitchenSurface: '#A0AEC0',
  kitchenEquipment: '#4A5568',
  bar: '#C05621',
  barTop: '#DD6B20',
  barFootrest: '#7B341E',

  // Decor
  plant: '#48BB78',
  plantPot: '#8B5A2B',
  decor: '#9F7AEA',

  // Model
  model: '#9333EA',
  modelOutline: '#7C3AED',

  // Table statuses
  available: '#48BB78',
  occupied: '#F56565',
  reserved: '#ECC94B',

  // Selection states
  selected: '#3B82F6',
  hovered: '#60A5FA',
  dragging: '#818CF8',
} as const

// Plugin system types for future extensibility
export interface Map2DPlugin {
  id: string
  name: string
  enabled: boolean
}

export interface Map2DPluginHooks {
  onMapRender?: (ctx: CanvasRenderingContext2D) => void
  onObjectsGenerated?: (objects: Map2DObject[]) => void
  renderOverlay?: () => React.ReactNode
}

export interface Map2DPluginDefinition extends Map2DPlugin {
  hooks: Map2DPluginHooks
}

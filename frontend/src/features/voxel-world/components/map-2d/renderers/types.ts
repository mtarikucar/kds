import type { Map2DObject as Map2DObjectType } from '../../../types/map2d'

export interface RendererProps {
  object: Map2DObjectType
  scale: number
  isSelected: boolean
  isHovered: boolean
  isDragging: boolean
}

// Extended renderer props with canvas dimensions
export interface RendererPropsWithDimensions extends RendererProps {
  canvasWidth: number
  canvasHeight: number
}

// Layer ordering for z-index (lower = rendered first/behind)
export const LAYER_ORDER: Record<string, number> = {
  floor: 0,
  wall: 1,
  window: 2,
  door: 3,
  kitchen: 4,
  bar: 5,
  table: 6,
  chair: 7,
  decor: 8,
  model: 9,
}

// Professional color palette for 2D map
export const MAP2D_COLORS_PRO = {
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

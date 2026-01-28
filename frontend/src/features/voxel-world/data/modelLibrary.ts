import type { ModelLibraryItem, ModelCategory } from '../types/voxel'

export const MODEL_LIBRARY: ModelLibraryItem[] = [
  // Furniture (Box.glb is 2 units, so scale accordingly)
  {
    id: 'model-table-round',
    name: 'Round Table',
    category: 'furniture',
    modelUrl: '/app/models/furniture/round-table.glb',
    description: 'Round wooden table for 2-4 people',
    defaultScale: 0.5,
    dimensions: { width: 2, height: 1, depth: 2 },
  },
  {
    id: 'model-table-rectangular',
    name: 'Rectangular Table',
    category: 'furniture',
    modelUrl: '/app/models/furniture/rectangular-table.glb',
    description: 'Rectangular dining table for 4-6 people',
    defaultScale: 2.5,
    dimensions: { width: 3, height: 1, depth: 2 },
  },
  {
    id: 'model-chair-dining',
    name: 'Dining Chair',
    category: 'furniture',
    modelUrl: '/app/models/furniture/dining-chair.glb',
    description: 'Classic dining chair',
    defaultScale: 1.5,
    dimensions: { width: 1, height: 1, depth: 1 },
  },
  {
    id: 'model-bar-stool',
    name: 'Bar Stool',
    category: 'furniture',
    modelUrl: '/app/models/furniture/bar-stool.glb',
    description: 'Modern bar stool',
    defaultScale: 1.5,
    dimensions: { width: 1, height: 1, depth: 1 },
  },
  {
    id: 'model-booth',
    name: 'Booth Seating',
    category: 'furniture',
    modelUrl: '/app/models/furniture/booth.glb',
    description: 'Restaurant booth for 4 people',
    defaultScale: 3,
    dimensions: { width: 4, height: 2, depth: 2 },
  },

  // Equipment
  {
    id: 'model-coffee-machine',
    name: 'Coffee Machine',
    category: 'equipment',
    modelUrl: '/app/models/equipment/coffee-machine.glb',
    description: 'Professional espresso machine',
    defaultScale: 1.5,
    dimensions: { width: 1, height: 1, depth: 1 },
    animations: ['brewing'],
  },
  {
    id: 'model-cash-register',
    name: 'Cash Register',
    category: 'equipment',
    modelUrl: '/app/models/equipment/cash-register.glb',
    description: 'POS terminal and cash register',
    defaultScale: 1.2,
    dimensions: { width: 1, height: 1, depth: 1 },
  },
  {
    id: 'model-display-case',
    name: 'Display Case',
    category: 'equipment',
    modelUrl: '/app/models/equipment/display-case.glb',
    description: 'Glass display case for food items',
    defaultScale: 2,
    dimensions: { width: 2, height: 2, depth: 1 },
  },
  {
    id: 'model-refrigerator',
    name: 'Refrigerator',
    category: 'equipment',
    modelUrl: '/app/models/equipment/refrigerator.glb',
    description: 'Commercial refrigerator',
    defaultScale: 2.5,
    dimensions: { width: 2, height: 3, depth: 1 },
    animations: ['door_open'],
  },

  // Decoration
  {
    id: 'model-plant-large',
    name: 'Large Plant',
    category: 'decoration',
    modelUrl: '/app/models/decoration/plant-large.glb',
    description: 'Decorative indoor plant',
    defaultScale: 2,
    dimensions: { width: 1, height: 2, depth: 1 },
  },
  {
    id: 'model-plant-small',
    name: 'Small Plant',
    category: 'decoration',
    modelUrl: '/app/models/decoration/plant-small.glb',
    description: 'Small potted plant for tables',
    defaultScale: 1,
    dimensions: { width: 1, height: 1, depth: 1 },
  },
  {
    id: 'model-lamp-floor',
    name: 'Floor Lamp',
    category: 'decoration',
    modelUrl: '/app/models/decoration/floor-lamp.glb',
    description: 'Standing floor lamp',
    defaultScale: 2.5,
    dimensions: { width: 1, height: 3, depth: 1 },
  },
  {
    id: 'model-lamp-table',
    name: 'Table Lamp',
    category: 'decoration',
    modelUrl: '/app/models/decoration/table-lamp.glb',
    description: 'Small table lamp',
    defaultScale: 1,
    dimensions: { width: 1, height: 1, depth: 1 },
  },
  {
    id: 'model-painting',
    name: 'Wall Painting',
    category: 'decoration',
    modelUrl: '/app/models/decoration/painting.glb',
    description: 'Framed wall art',
    defaultScale: 2,
    dimensions: { width: 2, height: 2, depth: 1 },
  },
  {
    id: 'model-clock',
    name: 'Wall Clock',
    category: 'decoration',
    modelUrl: '/app/models/decoration/wall-clock.glb',
    description: 'Decorative wall clock',
    defaultScale: 1,
    dimensions: { width: 1, height: 1, depth: 1 },
    animations: ['ticking'],
  },
]

export const MODEL_CATEGORIES: { id: ModelCategory; name: string; icon: string }[] = [
  { id: 'furniture', name: 'Furniture', icon: 'sofa' },
  { id: 'equipment', name: 'Equipment', icon: 'coffee' },
  { id: 'decoration', name: 'Decoration', icon: 'flower' },
  { id: 'custom', name: 'Custom', icon: 'upload' },
]

export function getModelsByCategory(category: ModelCategory): ModelLibraryItem[] {
  return MODEL_LIBRARY.filter((model) => model.category === category)
}

export function getModelById(id: string): ModelLibraryItem | undefined {
  return MODEL_LIBRARY.find((model) => model.id === id)
}

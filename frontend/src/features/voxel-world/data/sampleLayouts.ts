import type { VoxelObject } from '../types/voxel'
import { TableStatus } from '@/types'

export interface SampleLayout {
  name: string
  description: string
  objects: VoxelObject[]
}

/**
 * Standard restaurant layout for a 32x32 world.
 *
 * Zone layout:
 *   z=0 (back wall)
 *   - Kitchen zone: z 2-6
 *   - Bar zone: x 26-30, z 8-28
 *   - Dining zone: x 2-24, z 8-28
 *   z=32 (front wall / entrance side)
 */
const STANDARD_RESTAURANT: SampleLayout = {
  name: 'Standart Restoran',
  description: 'Mutfak, bar, masalar ve dekorasyon iceren hazir restoran sablonu',
  objects: [
    // --- Kitchen station (back wall, centered) ---
    {
      id: 'sample-kitchen-1',
      type: 'kitchen',
      position: { x: 14, y: 0, z: 2 },
      rotation: { y: 0 },
      metadata: {
        libraryItemId: 'kitchen-station',
        dimensions: { width: 3, height: 2, depth: 2 },
      },
    },

    // --- Bar counter (right wall) ---
    {
      id: 'sample-bar-1',
      type: 'bar',
      position: { x: 27, y: 0, z: 14 },
      rotation: { y: 90 },
      metadata: {
        libraryItemId: 'bar-counter',
        dimensions: { width: 4, height: 1, depth: 1 },
      },
    },

    // --- 2-seat tables (window side, front wall area) ---
    {
      id: 'sample-table2-1',
      type: 'table',
      position: { x: 3, y: 0, z: 27 },
      rotation: { y: 0 },
      linkedTableId: '',
      status: TableStatus.AVAILABLE,
      tableNumber: 'T1',
      capacity: 2,
      metadata: {
        libraryItemId: 'table-2',
        dimensions: { width: 2, height: 1, depth: 2 },
      },
    } as VoxelObject,
    {
      id: 'sample-table2-2',
      type: 'table',
      position: { x: 8, y: 0, z: 27 },
      rotation: { y: 0 },
      linkedTableId: '',
      status: TableStatus.AVAILABLE,
      tableNumber: 'T2',
      capacity: 2,
      metadata: {
        libraryItemId: 'table-2',
        dimensions: { width: 2, height: 1, depth: 2 },
      },
    } as VoxelObject,

    // --- 4-seat tables (center dining area) ---
    {
      id: 'sample-table4-1',
      type: 'table',
      position: { x: 5, y: 0, z: 14 },
      rotation: { y: 0 },
      linkedTableId: '',
      status: TableStatus.AVAILABLE,
      tableNumber: 'T3',
      capacity: 4,
      metadata: {
        libraryItemId: 'table-4',
        dimensions: { width: 3, height: 1, depth: 3 },
      },
    } as VoxelObject,
    {
      id: 'sample-table4-2',
      type: 'table',
      position: { x: 12, y: 0, z: 14 },
      rotation: { y: 0 },
      linkedTableId: '',
      status: TableStatus.AVAILABLE,
      tableNumber: 'T4',
      capacity: 4,
      metadata: {
        libraryItemId: 'table-4',
        dimensions: { width: 3, height: 1, depth: 3 },
      },
    } as VoxelObject,
    {
      id: 'sample-table4-3',
      type: 'table',
      position: { x: 19, y: 0, z: 14 },
      rotation: { y: 0 },
      linkedTableId: '',
      status: TableStatus.AVAILABLE,
      tableNumber: 'T5',
      capacity: 4,
      metadata: {
        libraryItemId: 'table-4',
        dimensions: { width: 3, height: 1, depth: 3 },
      },
    } as VoxelObject,

    // --- 6-seat table (large group, center-front) ---
    {
      id: 'sample-table6-1',
      type: 'table',
      position: { x: 10, y: 0, z: 21 },
      rotation: { y: 0 },
      linkedTableId: '',
      status: TableStatus.AVAILABLE,
      tableNumber: 'T6',
      capacity: 6,
      metadata: {
        libraryItemId: 'table-6',
        dimensions: { width: 4, height: 1, depth: 3 },
      },
    } as VoxelObject,

    // --- Decorative plants (corners and dividers) ---
    {
      id: 'sample-plant-1',
      type: 'decor',
      position: { x: 2, y: 0, z: 2 },
      rotation: { y: 0 },
      metadata: {
        libraryItemId: 'plant',
        dimensions: { width: 1, height: 2, depth: 1 },
      },
    },
    {
      id: 'sample-plant-2',
      type: 'decor',
      position: { x: 29, y: 0, z: 2 },
      rotation: { y: 0 },
      metadata: {
        libraryItemId: 'plant',
        dimensions: { width: 1, height: 2, depth: 1 },
      },
    },
    {
      id: 'sample-plant-3',
      type: 'decor',
      position: { x: 2, y: 0, z: 29 },
      rotation: { y: 0 },
      metadata: {
        libraryItemId: 'plant',
        dimensions: { width: 1, height: 2, depth: 1 },
      },
    },
    {
      id: 'sample-plant-4',
      type: 'decor',
      position: { x: 23, y: 0, z: 20 },
      rotation: { y: 0 },
      metadata: {
        libraryItemId: 'plant',
        dimensions: { width: 1, height: 2, depth: 1 },
      },
    },
  ],
}

export const SAMPLE_LAYOUTS: SampleLayout[] = [STANDARD_RESTAURANT]

export function getSampleLayout(name?: string): SampleLayout {
  if (name) {
    return SAMPLE_LAYOUTS.find((l) => l.name === name) ?? SAMPLE_LAYOUTS[0]
  }
  return SAMPLE_LAYOUTS[0]
}

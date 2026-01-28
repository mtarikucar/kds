import type { VoxelObject, VoxelPosition, VoxelObjectType } from '../types/voxel'
import type { Map2DObject } from '../types/map2d'
import { VOXEL_COLORS } from '../types/voxel'
import { MAP2D_COLORS } from '../types/map2d'

/**
 * Calculate table dimensions based on capacity
 * More capacity = larger table, with realistic proportions
 */
function getTableDimensionsByCapacity(capacity: number): { width: number; depth: number } {
  // Realistic table sizes based on capacity
  const tableSizes: Record<number, { width: number; depth: number }> = {
    1: { width: 1.5, depth: 1.5 },  // Small bistro table
    2: { width: 2, depth: 2 },      // 2-person table
    3: { width: 2.5, depth: 2 },    // Small 3-person
    4: { width: 3, depth: 2.5 },    // Standard 4-person
    5: { width: 3.5, depth: 2.5 },  // 5-person
    6: { width: 4, depth: 3 },      // 6-person rectangular
    7: { width: 4.5, depth: 3 },    // 7-person
    8: { width: 5, depth: 3 },      // 8-person long table
    10: { width: 6, depth: 3.5 },   // 10-person banquet
    12: { width: 7, depth: 4 },     // 12-person large banquet
  }

  // Find closest capacity match
  if (tableSizes[capacity]) {
    return tableSizes[capacity]
  }

  // Interpolate for non-standard capacities
  if (capacity <= 1) return tableSizes[1]
  if (capacity >= 12) {
    // Scale linearly for very large tables
    const baseWidth = 7 + (capacity - 12) * 0.5
    const baseDepth = 4 + (capacity - 12) * 0.2
    return { width: baseWidth, depth: baseDepth }
  }

  // Find surrounding sizes and interpolate
  const sizes = Object.keys(tableSizes).map(Number).sort((a, b) => a - b)
  let lower = sizes[0]
  let upper = sizes[sizes.length - 1]

  for (let i = 0; i < sizes.length - 1; i++) {
    if (sizes[i] <= capacity && sizes[i + 1] >= capacity) {
      lower = sizes[i]
      upper = sizes[i + 1]
      break
    }
  }

  const ratio = (capacity - lower) / (upper - lower)
  const lowerSize = tableSizes[lower]
  const upperSize = tableSizes[upper]

  return {
    width: lowerSize.width + (upperSize.width - lowerSize.width) * ratio,
    depth: lowerSize.depth + (upperSize.depth - lowerSize.depth) * ratio,
  }
}

/**
 * Get the footprint dimensions for an object type
 * Uses metadata dimensions first, then calculates based on capacity/type
 */
export function getObjectDimensions(
  type: VoxelObjectType,
  metadata?: Record<string, unknown>
): { width: number; depth: number } {
  // 1. Check if metadata contains explicit dimension info
  if (metadata?.dimensions) {
    const dims = metadata.dimensions as { width?: number; depth?: number }
    if (dims.width !== undefined && dims.depth !== undefined) {
      return {
        width: dims.width,
        depth: dims.depth,
      }
    }
  }

  // 2. For tables, calculate based on capacity
  if (type === 'table' && metadata?.capacity) {
    const capacity = Number(metadata.capacity) || 4
    return getTableDimensionsByCapacity(capacity)
  }

  // 3. For models, use model-specific dimensions if available
  if (type === 'model' && metadata?.modelConfig) {
    const modelConfig = metadata.modelConfig as { dimensions?: { width: number; depth: number } }
    if (modelConfig.dimensions) {
      return {
        width: modelConfig.dimensions.width,
        depth: modelConfig.dimensions.depth,
      }
    }
  }

  // 4. Default dimensions by type
  const defaultDimensions: Record<VoxelObjectType, { width: number; depth: number }> = {
    table: { width: 2, depth: 2 },      // Default 2-person
    chair: { width: 0.8, depth: 0.8 },  // Realistic chair size
    kitchen: { width: 3, depth: 2 },
    bar: { width: 4, depth: 1.2 },
    decor: { width: 1, depth: 1 },
    wall: { width: 1, depth: 0.3 },     // Thin walls
    floor: { width: 1, depth: 1 },
    door: { width: 1.5, depth: 0.3 },   // Standard door width
    window: { width: 1.5, depth: 0.2 }, // Thin window
    model: { width: 1, depth: 1 },
  }

  return defaultDimensions[type] ?? { width: 1, depth: 1 }
}

/**
 * Get color for an object type
 */
export function getObjectColor(
  type: VoxelObjectType,
  status?: string
): string {
  // Status-based colors (for tables)
  if (type === 'table' && status) {
    switch (status) {
      case 'available':
        return VOXEL_COLORS.available
      case 'occupied':
        return VOXEL_COLORS.occupied
      case 'reserved':
        return VOXEL_COLORS.reserved
    }
  }

  return MAP2D_COLORS[type] ?? '#6B7280'
}

/**
 * Get label for an object
 */
export function getObjectLabel(object: VoxelObject): string | undefined {
  // Tables show their number
  if (object.type === 'table' && object.metadata?.tableNumber) {
    return String(object.metadata.tableNumber)
  }

  // Models show their name
  if (object.type === 'model' && object.metadata?.name) {
    return String(object.metadata.name)
  }

  return undefined
}

/**
 * Extract shape from metadata
 */
function getObjectShape(object: VoxelObject): 'rectangle' | 'round' | 'oval' | 'L-shaped' | undefined {
  if (object.metadata?.shape) {
    return object.metadata.shape as 'rectangle' | 'round' | 'oval' | 'L-shaped'
  }
  return undefined
}

/**
 * Extract variant from metadata
 */
function getObjectVariant(object: VoxelObject): string | undefined {
  if (object.metadata?.variant) {
    return String(object.metadata.variant)
  }
  return undefined
}

/**
 * Convert a VoxelObject (3D) to Map2DObject (2D top-down view)
 * Y-axis in 3D is ignored (height), X stays X, Z becomes the Y in 2D view
 */
export function voxelToMap2D(object: VoxelObject): Map2DObject {
  const dimensions = getObjectDimensions(object.type, object.metadata)
  const status = object.metadata?.status as string | undefined
  const color = getObjectColor(object.type, status)
  const label = getObjectLabel(object)
  const shape = getObjectShape(object)
  const variant = getObjectVariant(object)
  const capacity = object.metadata?.capacity as number | undefined
  const linkedTableId = object.linkedTableId

  return {
    id: object.id,
    type: object.type,
    x: object.position.x,
    z: object.position.z,
    width: dimensions.width,
    depth: dimensions.depth,
    rotation: object.rotation.y,
    color,
    label,
    capacity,
    shape,
    variant,
    linkedTableId,
    status: status as 'available' | 'occupied' | 'reserved' | undefined,
  }
}

/**
 * Convert Map2DObject position back to VoxelPosition
 * Maintains the original Y (height) position
 */
export function map2DToVoxelPosition(
  map2dObject: Map2DObject,
  originalY: number = 0
): VoxelPosition {
  return {
    x: map2dObject.x,
    y: originalY,
    z: map2dObject.z,
  }
}

/**
 * Convert a list of VoxelObjects to Map2DObjects
 */
export function voxelObjectsToMap2D(objects: VoxelObject[]): Map2DObject[] {
  return objects.map(voxelToMap2D)
}

/**
 * Snap position to grid
 */
export function snapToGrid(
  position: { x: number; z: number },
  gridSize: number
): { x: number; z: number } {
  return {
    x: Math.round(position.x / gridSize) * gridSize,
    z: Math.round(position.z / gridSize) * gridSize,
  }
}

/**
 * Check if two rectangles overlap (for collision detection)
 */
export function checkOverlap(
  obj1: Map2DObject,
  obj2: Map2DObject
): boolean {
  // Simple AABB collision detection
  const obj1Right = obj1.x + obj1.width
  const obj1Bottom = obj1.z + obj1.depth
  const obj2Right = obj2.x + obj2.width
  const obj2Bottom = obj2.z + obj2.depth

  return !(
    obj1.x >= obj2Right ||
    obj1Right <= obj2.x ||
    obj1.z >= obj2Bottom ||
    obj1Bottom <= obj2.z
  )
}

/**
 * Check if a position is within bounds
 */
export function isWithinBounds(
  obj: Map2DObject,
  bounds: { width: number; height: number }
): boolean {
  return (
    obj.x >= 0 &&
    obj.z >= 0 &&
    obj.x + obj.width <= bounds.width &&
    obj.z + obj.depth <= bounds.height
  )
}

/**
 * Find an object at a given position
 */
export function findObjectAtPosition(
  objects: Map2DObject[],
  x: number,
  z: number
): Map2DObject | undefined {
  return objects.find((obj) => {
    return (
      x >= obj.x &&
      x < obj.x + obj.width &&
      z >= obj.z &&
      z < obj.z + obj.depth
    )
  })
}

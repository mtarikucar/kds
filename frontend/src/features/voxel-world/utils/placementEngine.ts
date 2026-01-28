import type {
  VoxelObject,
  VoxelObjectType,
  VoxelPosition,
  WorldDimensions,
} from '../types/voxel'

// --- Placement Rules ---

export interface PlacementRules {
  minWallClearance: number
  minObjectSpacing: number
  tableClearance: number
  kitchenClearance: number
  barFrontClearance: number
  pathWidth: number
}

export const DEFAULT_PLACEMENT_RULES: PlacementRules = {
  minWallClearance: 1,
  minObjectSpacing: 1,
  tableClearance: 2,
  kitchenClearance: 3,
  barFrontClearance: 2,
  pathWidth: 2,
}

// --- AABB (Axis-Aligned Bounding Box) ---

export interface AABB {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

// --- Zone Definitions ---

export interface Zone {
  name: string
  bounds: AABB
  allowedTypes: VoxelObjectType[]
  priority: number
}

export function createZones(dimensions: WorldDimensions): Zone[] {
  const { width, depth } = dimensions
  return [
    {
      name: 'kitchen',
      bounds: { minX: 2, maxX: width - 2, minZ: 2, maxZ: 6 },
      allowedTypes: ['kitchen'],
      priority: 1,
    },
    {
      name: 'bar',
      bounds: { minX: width - 6, maxX: width - 2, minZ: 8, maxZ: depth - 2 },
      allowedTypes: ['bar'],
      priority: 2,
    },
    {
      name: 'dining',
      bounds: { minX: 2, maxX: width - 8, minZ: 8, maxZ: depth - 2 },
      allowedTypes: ['table', 'chair'],
      priority: 3,
    },
    {
      name: 'decor',
      bounds: { minX: 1, maxX: width - 1, minZ: 1, maxZ: depth - 1 },
      allowedTypes: ['decor'],
      priority: 4,
    },
  ]
}

// --- Object Dimensions Helper ---

function getObjectDimensions(obj: VoxelObject): { width: number; depth: number } {
  const meta = obj.metadata as Record<string, unknown> | undefined
  if (meta?.dimensions) {
    const dims = meta.dimensions as { width: number; depth: number }
    return { width: dims.width, depth: dims.depth }
  }

  // Fallback defaults per type
  switch (obj.type) {
    case 'table':
      return { width: 3, depth: 3 }
    case 'chair':
      return { width: 1, depth: 1 }
    case 'kitchen':
      return { width: 3, depth: 2 }
    case 'bar':
      return { width: 4, depth: 1 }
    case 'decor':
      return { width: 1, depth: 1 }
    case 'wall':
      return { width: 1, depth: 1 }
    default:
      return { width: 2, depth: 2 }
  }
}

// --- Clearance per type ---

export function getObjectClearance(
  type: VoxelObjectType,
  rules: PlacementRules = DEFAULT_PLACEMENT_RULES,
): number {
  switch (type) {
    case 'kitchen':
      return rules.kitchenClearance
    case 'bar':
      return rules.barFrontClearance
    case 'table':
      return rules.tableClearance
    default:
      return rules.minObjectSpacing
  }
}

// --- Core Functions ---

export function getObjectBounds(obj: VoxelObject): AABB {
  const dims = getObjectDimensions(obj)
  return {
    minX: obj.position.x,
    maxX: obj.position.x + dims.width,
    minZ: obj.position.z,
    maxZ: obj.position.z + dims.depth,
  }
}

function aabbOverlaps(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ
}

function expandAABB(bounds: AABB, clearance: number): AABB {
  return {
    minX: bounds.minX - clearance,
    maxX: bounds.maxX + clearance,
    minZ: bounds.minZ - clearance,
    maxZ: bounds.maxZ + clearance,
  }
}

export function checkCollision(
  newObj: VoxelObject,
  existingObjects: readonly VoxelObject[],
  rules: PlacementRules = DEFAULT_PLACEMENT_RULES,
): boolean {
  const newBounds = getObjectBounds(newObj)
  const clearance = getObjectClearance(newObj.type, rules)
  const expandedNew = expandAABB(newBounds, clearance)

  for (const existing of existingObjects) {
    if (existing.id === newObj.id) continue
    const existingBounds = getObjectBounds(existing)
    const existingClearance = getObjectClearance(existing.type, rules)
    const expandedExisting = expandAABB(existingBounds, existingClearance)

    // Check if either expanded box overlaps the other's raw box
    if (aabbOverlaps(expandedNew, existingBounds) || aabbOverlaps(newBounds, expandedExisting)) {
      return true
    }
  }

  return false
}

export function isWithinBounds(
  obj: VoxelObject,
  dimensions: WorldDimensions,
  rules: PlacementRules = DEFAULT_PLACEMENT_RULES,
): boolean {
  const bounds = getObjectBounds(obj)
  const wallClearance = rules.minWallClearance
  return (
    bounds.minX >= wallClearance &&
    bounds.maxX <= dimensions.width - wallClearance &&
    bounds.minZ >= wallClearance &&
    bounds.maxZ <= dimensions.depth - wallClearance
  )
}

// --- Position Suggestion (Spiral Search) ---

export function suggestPosition(
  type: VoxelObjectType,
  itemDimensions: { width: number; depth: number },
  existingObjects: readonly VoxelObject[],
  worldDimensions: WorldDimensions,
  rules: PlacementRules = DEFAULT_PLACEMENT_RULES,
): VoxelPosition | null {
  const zones = createZones(worldDimensions)
  const matchingZone = zones.find((z) => z.allowedTypes.includes(type))

  // Search area: matching zone or full world
  const searchBounds: AABB = matchingZone
    ? matchingZone.bounds
    : {
        minX: rules.minWallClearance,
        maxX: worldDimensions.width - rules.minWallClearance,
        minZ: rules.minWallClearance,
        maxZ: worldDimensions.depth - rules.minWallClearance,
      }

  // Center of search area
  const centerX = Math.floor((searchBounds.minX + searchBounds.maxX) / 2)
  const centerZ = Math.floor((searchBounds.minZ + searchBounds.maxZ) / 2)

  // Spiral search from center outward
  const maxRadius = Math.max(
    worldDimensions.width,
    worldDimensions.depth,
  )

  for (let radius = 0; radius < maxRadius; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        // Only check perimeter of this radius (skip inner already checked)
        if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue

        const x = centerX + dx
        const z = centerZ + dz

        const candidate: VoxelObject = {
          id: '__candidate__',
          type,
          position: { x, y: 0, z },
          rotation: { y: 0 },
          metadata: { dimensions: itemDimensions },
        }

        if (
          isWithinBounds(candidate, worldDimensions, rules) &&
          !checkCollision(candidate, existingObjects, rules)
        ) {
          return { x, y: 0, z }
        }
      }
    }
  }

  return null
}

// --- Auto-Arrange Algorithm ---

interface ObjectGroup {
  type: VoxelObjectType
  objects: VoxelObject[]
}

const TYPE_PRIORITY: VoxelObjectType[] = ['kitchen', 'bar', 'table', 'chair', 'decor']

function groupByType(objects: readonly VoxelObject[]): ObjectGroup[] {
  const groups = new Map<VoxelObjectType, VoxelObject[]>()

  for (const obj of objects) {
    const existing = groups.get(obj.type)
    if (existing) {
      existing.push(obj)
    } else {
      groups.set(obj.type, [obj])
    }
  }

  return TYPE_PRIORITY
    .filter((type) => groups.has(type))
    .map((type) => ({
      type,
      objects: groups.get(type)!,
    }))
}

function sortTablesBySize(objects: VoxelObject[]): VoxelObject[] {
  return [...objects].sort((a, b) => {
    const dimsA = getObjectDimensions(a)
    const dimsB = getObjectDimensions(b)
    return dimsB.width * dimsB.depth - dimsA.width * dimsA.depth
  })
}

export function autoArrange(
  objects: readonly VoxelObject[],
  worldDimensions: WorldDimensions,
  rules: PlacementRules = DEFAULT_PLACEMENT_RULES,
): VoxelObject[] {
  const groups = groupByType(objects)
  const placed: VoxelObject[] = []

  for (const group of groups) {
    const toPlace = group.type === 'table'
      ? sortTablesBySize(group.objects)
      : group.objects

    for (const obj of toPlace) {
      const dims = getObjectDimensions(obj)
      const newPos = suggestPosition(
        obj.type,
        dims,
        placed,
        worldDimensions,
        rules,
      )

      if (newPos) {
        placed.push({
          ...obj,
          position: newPos,
        })
      } else {
        // Could not find a spot; keep original position
        placed.push(obj)
      }
    }
  }

  return placed
}

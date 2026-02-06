import type { VoxelObject, VoxelPosition, WorldDimensions } from '../../types/voxel'
import { checkCollision } from '../placementEngine'
import { cellKey, getNeighborMask, NEIGHBOR_MASKS } from './floorCellManager'

// Use native crypto.randomUUID() for generating unique IDs
const generateId = (): string => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export type DecorType = 'plant' | 'lamp' | 'art' | 'divider'

interface DecorConfig {
  type: DecorType
  dimensions: { width: number; depth: number; height: number }
  preferredLocations: ('corner' | 'wall' | 'center' | 'above-table')[]
  spacing: number
}

const DECOR_CONFIGS: Record<DecorType, DecorConfig> = {
  plant: {
    type: 'plant',
    dimensions: { width: 1, depth: 1, height: 2 },
    preferredLocations: ['corner', 'wall'],
    spacing: 3,
  },
  lamp: {
    type: 'lamp',
    dimensions: { width: 0.5, depth: 0.5, height: 0.3 },
    preferredLocations: ['above-table'],
    spacing: 0,
  },
  art: {
    type: 'art',
    dimensions: { width: 2, depth: 0.1, height: 1.5 },
    preferredLocations: ['wall'],
    spacing: 4,
  },
  divider: {
    type: 'divider',
    dimensions: { width: 0.5, depth: 2, height: 1.5 },
    preferredLocations: ['center'],
    spacing: 5,
  },
}

/**
 * Find corner positions based on actual floor cells.
 * A "corner" is a floor cell with only 2 cardinal neighbors at a right angle.
 */
function findCornerPositionsFromCells(
  floorCells: Map<string, number>
): VoxelPosition[] {
  const positions: VoxelPosition[] = []

  for (const [key, height] of floorCells) {
    if (height <= 0) continue
    const [xStr, zStr] = key.split(',')
    const x = Number(xStr)
    const z = Number(zStr)
    const mask = getNeighborMask(floorCells, x, z)

    // Check cardinal neighbors only
    const hasN = (mask & NEIGHBOR_MASKS.N) !== 0
    const hasS = (mask & NEIGHBOR_MASKS.S) !== 0
    const hasE = (mask & NEIGHBOR_MASKS.E) !== 0
    const hasW = (mask & NEIGHBOR_MASKS.W) !== 0
    const cardinals = [hasN, hasS, hasE, hasW].filter(Boolean).length

    // Corner: exactly 2 adjacent cardinal neighbors (not opposite)
    if (cardinals === 2 && !(hasN && hasS) && !(hasE && hasW)) {
      positions.push({ x, y: 0, z })
    }
  }

  return positions
}

/**
 * Find edge/wall positions based on actual floor cells.
 * An "edge" cell has at least one missing cardinal neighbor (it's on the border).
 */
function findEdgePositionsFromCells(
  floorCells: Map<string, number>,
  spacing: number
): VoxelPosition[] {
  const edgeCells: VoxelPosition[] = []

  for (const [key, height] of floorCells) {
    if (height <= 0) continue
    const [xStr, zStr] = key.split(',')
    const x = Number(xStr)
    const z = Number(zStr)
    const mask = getNeighborMask(floorCells, x, z)

    const hasN = (mask & NEIGHBOR_MASKS.N) !== 0
    const hasS = (mask & NEIGHBOR_MASKS.S) !== 0
    const hasE = (mask & NEIGHBOR_MASKS.E) !== 0
    const hasW = (mask & NEIGHBOR_MASKS.W) !== 0
    const cardinals = [hasN, hasS, hasE, hasW].filter(Boolean).length

    // Edge cell: has 2-3 cardinal neighbors (not a corner with only 2, not fully surrounded)
    if (cardinals >= 2 && cardinals < 4) {
      edgeCells.push({ x, y: 0, z })
    }
  }

  // Space them out by the requested spacing
  if (spacing <= 1) return edgeCells

  const selected: VoxelPosition[] = []
  for (const pos of edgeCells) {
    const tooClose = selected.some(
      (s) => Math.abs(s.x - pos.x) + Math.abs(s.z - pos.z) < spacing
    )
    if (!tooClose) {
      selected.push(pos)
    }
  }

  return selected
}

/**
 * Fallback: Find corner positions from world dimensions (when no floor cells available)
 */
function findCornerPositions(
  dimensions: WorldDimensions,
  margin: number = 1
): VoxelPosition[] {
  return [
    { x: margin, y: 0, z: margin },
    { x: dimensions.width - margin - 1, y: 0, z: margin },
    { x: margin, y: 0, z: dimensions.depth - margin - 1 },
    { x: dimensions.width - margin - 1, y: 0, z: dimensions.depth - margin - 1 },
  ]
}

/**
 * Fallback: Find wall positions from world dimensions (when no floor cells available)
 */
function findWallPositions(
  dimensions: WorldDimensions,
  spacing: number,
  margin: number = 1
): VoxelPosition[] {
  const positions: VoxelPosition[] = []

  // North wall (z = margin)
  for (let x = margin + 2; x < dimensions.width - margin - 2; x += spacing) {
    positions.push({ x, y: 0, z: margin })
  }

  // South wall
  for (let x = margin + 2; x < dimensions.width - margin - 2; x += spacing) {
    positions.push({ x, y: 0, z: dimensions.depth - margin - 1 })
  }

  // West wall
  for (let z = margin + 2; z < dimensions.depth - margin - 2; z += spacing) {
    positions.push({ x: margin, y: 0, z })
  }

  // East wall
  for (let z = margin + 2; z < dimensions.depth - margin - 2; z += spacing) {
    positions.push({ x: dimensions.width - margin - 1, y: 0, z })
  }

  return positions
}

/**
 * Generate plants for corners
 */
export function generateCornerPlants(
  dimensions: WorldDimensions,
  existingObjects: VoxelObject[],
  floorCells?: Map<string, number>
): VoxelObject[] {
  const plants: VoxelObject[] = []
  const cornerPositions = floorCells && floorCells.size > 0
    ? findCornerPositionsFromCells(floorCells)
    : findCornerPositions(dimensions)
  const plantConfig = DECOR_CONFIGS.plant

  for (const position of cornerPositions) {
    // Check for collision
    const testObject: VoxelObject = {
      id: 'test',
      type: 'decor',
      position,
      rotation: { y: 0 },
      metadata: plantConfig.dimensions,
    }

    const hasCollision = checkCollision(testObject, existingObjects)

    if (!hasCollision) {
      plants.push({
        id: generateId(),
        type: 'decor',
        position,
        rotation: { y: Math.floor(Math.random() * 4) * 90 },
        metadata: {
          ...plantConfig.dimensions,
          decorType: 'plant',
          autoGenerated: true,
        },
      })
    }
  }

  return plants
}

/**
 * Generate hanging lamps above tables
 */
export function generateTableLamps(
  tables: VoxelObject[]
): VoxelObject[] {
  const lamps: VoxelObject[] = []
  const lampConfig = DECOR_CONFIGS.lamp

  for (const table of tables) {
    if (table.type !== 'table') continue

    const tableWidth = (table.metadata?.width as number) ?? 2
    const tableDepth = (table.metadata?.depth as number) ?? 2

    // Center lamp above table
    const lampPosition: VoxelPosition = {
      x: table.position.x + tableWidth / 2 - lampConfig.dimensions.width / 2,
      y: 2.5, // Hanging height
      z: table.position.z + tableDepth / 2 - lampConfig.dimensions.depth / 2,
    }

    lamps.push({
      id: generateId(),
      type: 'decor',
      position: lampPosition,
      rotation: { y: 0 },
      linkedTableId: table.id,
      metadata: {
        ...lampConfig.dimensions,
        decorType: 'lamp',
        autoGenerated: true,
      },
    })
  }

  return lamps
}

/**
 * Generate wall decorations
 */
export function generateWallDecor(
  dimensions: WorldDimensions,
  existingObjects: VoxelObject[],
  decorType: 'art' | 'plant' = 'art',
  floorCells?: Map<string, number>
): VoxelObject[] {
  const decor: VoxelObject[] = []
  const config = DECOR_CONFIGS[decorType]
  const wallPositions = floorCells && floorCells.size > 0
    ? findEdgePositionsFromCells(floorCells, config.spacing)
    : findWallPositions(dimensions, config.spacing)

  // Randomly select some positions
  const selectedPositions = wallPositions
    .sort(() => Math.random() - 0.5)
    .slice(0, Math.min(4, Math.floor(wallPositions.length / 2)))

  for (const position of selectedPositions) {
    const testObject: VoxelObject = {
      id: 'test',
      type: 'decor',
      position,
      rotation: { y: 0 },
      metadata: config.dimensions,
    }

    const hasCollision = checkCollision(testObject, existingObjects)

    if (!hasCollision) {
      // Determine rotation based on wall
      let rotation = 0
      if (position.x <= 2) rotation = 90
      else if (position.x >= dimensions.width - 2) rotation = 270
      else if (position.z <= 2) rotation = 0
      else rotation = 180

      decor.push({
        id: generateId(),
        type: 'decor',
        position: decorType === 'art' ? { ...position, y: 1.5 } : position,
        rotation: { y: rotation },
        metadata: {
          ...config.dimensions,
          decorType,
          autoGenerated: true,
        },
      })
    }
  }

  return decor
}

/**
 * Generate all procedural decorations for a layout
 */
export function generateAllDecor(
  dimensions: WorldDimensions,
  objects: VoxelObject[],
  options: {
    plants?: boolean
    lamps?: boolean
    art?: boolean
  } = { plants: true, lamps: true, art: true },
  floorCells?: Map<string, number>
): VoxelObject[] {
  let allDecor: VoxelObject[] = []
  const tables = objects.filter((obj) => obj.type === 'table')
  const existingDecor = objects.filter((obj) => obj.type === 'decor')

  // Filter out auto-generated decor for regeneration
  const manualDecor = existingDecor.filter(
    (obj) => !obj.metadata?.autoGenerated
  )
  const nonDecorObjects = objects.filter((obj) => obj.type !== 'decor')

  if (options.plants) {
    const plants = generateCornerPlants(dimensions, [
      ...nonDecorObjects,
      ...manualDecor,
    ], floorCells)
    allDecor = [...allDecor, ...plants]
  }

  if (options.lamps) {
    const lamps = generateTableLamps(tables)
    allDecor = [...allDecor, ...lamps]
  }

  if (options.art) {
    const art = generateWallDecor(dimensions, [
      ...nonDecorObjects,
      ...manualDecor,
      ...allDecor,
    ], 'art', floorCells)
    allDecor = [...allDecor, ...art]
  }

  return allDecor
}

/**
 * Remove all auto-generated decorations
 */
export function removeAutoGeneratedDecor(objects: VoxelObject[]): VoxelObject[] {
  return objects.filter(
    (obj) => obj.type !== 'decor' || !obj.metadata?.autoGenerated
  )
}

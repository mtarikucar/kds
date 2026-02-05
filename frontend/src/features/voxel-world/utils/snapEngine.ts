import type { VoxelObject, VoxelPosition, SnapConfig, SnapResult, SnapGuide } from '../types/voxel'

/**
 * Get the bounding box of an object
 */
function getObjectBounds(obj: VoxelObject): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const width = (obj.metadata?.width as number) ?? 1
  const depth = (obj.metadata?.depth as number) ?? 1
  return {
    minX: obj.position.x,
    maxX: obj.position.x + width,
    minZ: obj.position.z,
    maxZ: obj.position.z + depth,
  }
}

/**
 * Get the center of an object
 */
function getObjectCenter(obj: VoxelObject): { x: number; z: number } {
  const width = (obj.metadata?.width as number) ?? 1
  const depth = (obj.metadata?.depth as number) ?? 1
  return {
    x: obj.position.x + width / 2,
    z: obj.position.z + depth / 2,
  }
}

/**
 * Snap a value to the nearest grid line
 */
function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize
}

/**
 * Check if two values are close enough to snap
 */
function isCloseEnough(a: number, b: number, threshold: number): boolean {
  return Math.abs(a - b) <= threshold
}

/**
 * Calculate snap position for an object being moved
 */
export function calculateSnap(
  position: VoxelPosition,
  objectSize: { width: number; depth: number },
  otherObjects: VoxelObject[],
  config: SnapConfig,
  excludeId?: string
): SnapResult {
  if (!config.enabled) {
    return {
      position,
      snappedAxes: { x: false, z: false },
      guides: [],
    }
  }

  const { gridSize, edgeThreshold } = config
  const guides: SnapGuide[] = []
  let snappedX = position.x
  let snappedZ = position.z
  let xSnapped = false
  let zSnapped = false

  // Calculate object edges and center
  const objMinX = position.x
  const objMaxX = position.x + objectSize.width
  const objCenterX = position.x + objectSize.width / 2
  const objMinZ = position.z
  const objMaxZ = position.z + objectSize.depth
  const objCenterZ = position.z + objectSize.depth / 2

  // First try to snap to other objects (edge alignment)
  const relevantObjects = otherObjects.filter((obj) => obj.id !== excludeId)

  for (const other of relevantObjects) {
    const otherBounds = getObjectBounds(other)
    const otherCenter = getObjectCenter(other)

    // X-axis alignment
    if (!xSnapped) {
      // Left edge to left edge
      if (isCloseEnough(objMinX, otherBounds.minX, edgeThreshold)) {
        snappedX = otherBounds.minX
        xSnapped = true
        guides.push({
          type: 'edge',
          axis: 'x',
          position: otherBounds.minX,
          sourceObjectId: other.id,
        })
      }
      // Right edge to right edge
      else if (isCloseEnough(objMaxX, otherBounds.maxX, edgeThreshold)) {
        snappedX = otherBounds.maxX - objectSize.width
        xSnapped = true
        guides.push({
          type: 'edge',
          axis: 'x',
          position: otherBounds.maxX,
          sourceObjectId: other.id,
        })
      }
      // Left edge to right edge (adjacent)
      else if (isCloseEnough(objMinX, otherBounds.maxX, edgeThreshold)) {
        snappedX = otherBounds.maxX
        xSnapped = true
        guides.push({
          type: 'edge',
          axis: 'x',
          position: otherBounds.maxX,
          sourceObjectId: other.id,
        })
      }
      // Right edge to left edge (adjacent)
      else if (isCloseEnough(objMaxX, otherBounds.minX, edgeThreshold)) {
        snappedX = otherBounds.minX - objectSize.width
        xSnapped = true
        guides.push({
          type: 'edge',
          axis: 'x',
          position: otherBounds.minX,
          sourceObjectId: other.id,
        })
      }
      // Center alignment
      else if (isCloseEnough(objCenterX, otherCenter.x, edgeThreshold)) {
        snappedX = otherCenter.x - objectSize.width / 2
        xSnapped = true
        guides.push({
          type: 'center',
          axis: 'x',
          position: otherCenter.x,
          sourceObjectId: other.id,
        })
      }
    }

    // Z-axis alignment
    if (!zSnapped) {
      // Front edge to front edge
      if (isCloseEnough(objMinZ, otherBounds.minZ, edgeThreshold)) {
        snappedZ = otherBounds.minZ
        zSnapped = true
        guides.push({
          type: 'edge',
          axis: 'z',
          position: otherBounds.minZ,
          sourceObjectId: other.id,
        })
      }
      // Back edge to back edge
      else if (isCloseEnough(objMaxZ, otherBounds.maxZ, edgeThreshold)) {
        snappedZ = otherBounds.maxZ - objectSize.depth
        zSnapped = true
        guides.push({
          type: 'edge',
          axis: 'z',
          position: otherBounds.maxZ,
          sourceObjectId: other.id,
        })
      }
      // Front edge to back edge (adjacent)
      else if (isCloseEnough(objMinZ, otherBounds.maxZ, edgeThreshold)) {
        snappedZ = otherBounds.maxZ
        zSnapped = true
        guides.push({
          type: 'edge',
          axis: 'z',
          position: otherBounds.maxZ,
          sourceObjectId: other.id,
        })
      }
      // Back edge to front edge (adjacent)
      else if (isCloseEnough(objMaxZ, otherBounds.minZ, edgeThreshold)) {
        snappedZ = otherBounds.minZ - objectSize.depth
        zSnapped = true
        guides.push({
          type: 'edge',
          axis: 'z',
          position: otherBounds.minZ,
          sourceObjectId: other.id,
        })
      }
      // Center alignment
      else if (isCloseEnough(objCenterZ, otherCenter.z, edgeThreshold)) {
        snappedZ = otherCenter.z - objectSize.depth / 2
        zSnapped = true
        guides.push({
          type: 'center',
          axis: 'z',
          position: otherCenter.z,
          sourceObjectId: other.id,
        })
      }
    }
  }

  // If not snapped to objects, snap to grid
  if (!xSnapped) {
    const gridSnappedX = snapToGrid(position.x, gridSize)
    if (isCloseEnough(position.x, gridSnappedX, gridSize / 2)) {
      snappedX = gridSnappedX
      xSnapped = true
      guides.push({
        type: 'grid',
        axis: 'x',
        position: gridSnappedX,
      })
    }
  }

  if (!zSnapped) {
    const gridSnappedZ = snapToGrid(position.z, gridSize)
    if (isCloseEnough(position.z, gridSnappedZ, gridSize / 2)) {
      snappedZ = gridSnappedZ
      zSnapped = true
      guides.push({
        type: 'grid',
        axis: 'z',
        position: gridSnappedZ,
      })
    }
  }

  return {
    position: {
      x: snappedX,
      y: position.y,
      z: snappedZ,
    },
    snappedAxes: { x: xSnapped, z: zSnapped },
    guides,
  }
}

/**
 * Calculate snap for resize operation
 */
export function calculateResizeSnap(
  objectPosition: VoxelPosition,
  newSize: { width: number; depth: number },
  otherObjects: VoxelObject[],
  config: SnapConfig,
  excludeId?: string
): { size: { width: number; depth: number }; guides: SnapGuide[] } {
  if (!config.enabled) {
    return { size: newSize, guides: [] }
  }

  const { gridSize, edgeThreshold } = config
  const guides: SnapGuide[] = []

  // Snap size to grid
  let snappedWidth = snapToGrid(newSize.width, gridSize)
  let snappedDepth = snapToGrid(newSize.depth, gridSize)

  // Ensure minimum size
  snappedWidth = Math.max(1, snappedWidth)
  snappedDepth = Math.max(1, snappedDepth)

  // Check alignment with other objects
  const relevantObjects = otherObjects.filter((obj) => obj.id !== excludeId)
  const newMaxX = objectPosition.x + snappedWidth
  const newMaxZ = objectPosition.z + snappedDepth

  for (const other of relevantObjects) {
    const otherBounds = getObjectBounds(other)

    // Align right edge with other object edges
    if (isCloseEnough(newMaxX, otherBounds.minX, edgeThreshold)) {
      snappedWidth = otherBounds.minX - objectPosition.x
      guides.push({
        type: 'edge',
        axis: 'x',
        position: otherBounds.minX,
        sourceObjectId: other.id,
      })
    } else if (isCloseEnough(newMaxX, otherBounds.maxX, edgeThreshold)) {
      snappedWidth = otherBounds.maxX - objectPosition.x
      guides.push({
        type: 'edge',
        axis: 'x',
        position: otherBounds.maxX,
        sourceObjectId: other.id,
      })
    }

    // Align back edge with other object edges
    if (isCloseEnough(newMaxZ, otherBounds.minZ, edgeThreshold)) {
      snappedDepth = otherBounds.minZ - objectPosition.z
      guides.push({
        type: 'edge',
        axis: 'z',
        position: otherBounds.minZ,
        sourceObjectId: other.id,
      })
    } else if (isCloseEnough(newMaxZ, otherBounds.maxZ, edgeThreshold)) {
      snappedDepth = otherBounds.maxZ - objectPosition.z
      guides.push({
        type: 'edge',
        axis: 'z',
        position: otherBounds.maxZ,
        sourceObjectId: other.id,
      })
    }
  }

  return {
    size: {
      width: Math.max(1, snappedWidth),
      depth: Math.max(1, snappedDepth),
    },
    guides,
  }
}

/**
 * Default snap configuration
 */
export const DEFAULT_SNAP_CONFIG: SnapConfig = {
  gridSize: 0.5,
  edgeThreshold: 0.3,
  enabled: true,
  showGuides: true,
}

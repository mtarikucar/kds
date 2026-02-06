/**
 * Dirty Region Tracker
 *
 * Maps cell changes to affected chunk keys.
 * When a cell changes, we mark the 3x3 region of chunks
 * centered on that cell's chunk as dirty.
 */

import type { ChunkKey } from '../types/chunks'
import { cellToChunk, chunkKey } from '../types/chunks'

/**
 * Get the set of dirty chunk keys resulting from a cell change at (x, z).
 * Marks the cell's chunk plus all 8 neighbors (3x3 region).
 */
export function getDirtyChunksForCell(
  x: number,
  z: number
): ChunkKey[] {
  const coord = cellToChunk(x, z)
  const dirty: ChunkKey[] = []

  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      dirty.push(chunkKey(coord.cx + dx, coord.cz + dz))
    }
  }

  return dirty
}

/**
 * Get dirty chunks for multiple cell changes.
 * Deduplicates chunk keys.
 */
export function getDirtyChunksForCells(
  cellChanges: ReadonlyArray<{ x: number; z: number }>
): ChunkKey[] {
  const seen = new Set<ChunkKey>()
  const result: ChunkKey[] = []

  for (const { x, z } of cellChanges) {
    const chunks = getDirtyChunksForCell(x, z)
    for (const key of chunks) {
      if (!seen.has(key)) {
        seen.add(key)
        result.push(key)
      }
    }
  }

  return result
}

/**
 * Get dirty chunks from a stair change.
 * Includes both the stair cell and its neighbor cell's chunks.
 */
export function getDirtyChunksForStair(
  x: number,
  z: number,
  side: 'n' | 'e' | 's' | 'w'
): ChunkKey[] {
  const neighborOffsets: Record<string, { dx: number; dz: number }> = {
    n: { dx: 0, dz: -1 },
    s: { dx: 0, dz: 1 },
    e: { dx: 1, dz: 0 },
    w: { dx: -1, dz: 0 },
  }

  const offset = neighborOffsets[side]
  const neighborX = x + offset.dx
  const neighborZ = z + offset.dz

  return getDirtyChunksForCells([
    { x, z },
    { x: neighborX, z: neighborZ },
  ])
}

/**
 * Chunk System Types
 *
 * 4x4 cell chunks for incremental geometry rebuild.
 * Only dirty chunks are re-evaluated and re-rendered.
 */

import type { StructuralOutput } from './worldModel'

/**
 * Chunk size in cells (4x4 per chunk).
 */
export const CHUNK_SIZE = 4

/**
 * Chunk key format: "cx,cz" where cx/cz are chunk coordinates.
 */
export type ChunkKey = string

/**
 * Chunk coordinate (integer grid of chunks).
 */
export interface ChunkCoord {
  readonly cx: number
  readonly cz: number
}

/**
 * Data for a single chunk including its structural output.
 */
export interface ChunkData {
  readonly key: ChunkKey
  readonly coord: ChunkCoord
  readonly structure: StructuralOutput
  readonly dirty: boolean
  readonly geometryVersion: number
}

/**
 * State of the chunk manager.
 */
export interface ChunkManagerState {
  readonly chunks: ReadonlyMap<ChunkKey, ChunkData>
  readonly dirtyChunks: ReadonlySet<ChunkKey>
}

/**
 * Generate a chunk key from chunk coordinates.
 */
export function chunkKey(cx: number, cz: number): ChunkKey {
  return `${cx},${cz}`
}

/**
 * Parse a chunk key back to coordinates.
 */
export function parseChunkKey(key: ChunkKey): ChunkCoord {
  const [cx, cz] = key.split(',').map(Number)
  return { cx, cz }
}

/**
 * Get the chunk coordinate for a cell position.
 */
export function cellToChunk(x: number, z: number): ChunkCoord {
  return {
    cx: Math.floor(x / CHUNK_SIZE),
    cz: Math.floor(z / CHUNK_SIZE),
  }
}

/**
 * Get the cell range covered by a chunk.
 */
export function chunkCellRange(coord: ChunkCoord): {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
} {
  return {
    minX: coord.cx * CHUNK_SIZE,
    maxX: (coord.cx + 1) * CHUNK_SIZE - 1,
    minZ: coord.cz * CHUNK_SIZE,
    maxZ: (coord.cz + 1) * CHUNK_SIZE - 1,
  }
}

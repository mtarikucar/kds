/**
 * Chunk Manager
 *
 * Manages 4x4 cell chunks for incremental geometry rebuild.
 * Only dirty chunks are re-evaluated and re-rendered.
 */

import type { StairSegment } from '../types/voxel'
import type { EdgeClassification, StructuralOutput, EdgeKey } from '../types/worldModel'
import type { StructuralRule } from '../types/ruleEngine'
import type { ChunkData, ChunkKey, ChunkManagerState, ChunkCoord } from '../types/chunks'
import { CHUNK_SIZE, chunkKey, cellToChunk, chunkCellRange } from '../types/chunks'
import { evaluateRegion } from './ruleEvaluator'

/**
 * Create an empty chunk manager state.
 */
export function createChunkManager(): ChunkManagerState {
  return {
    chunks: new Map(),
    dirtyChunks: new Set(),
  }
}

/**
 * Mark specific chunks as dirty.
 */
export function markDirty(
  state: ChunkManagerState,
  chunkKeys: ReadonlyArray<ChunkKey>
): ChunkManagerState {
  const newDirty = new Set(state.dirtyChunks)
  for (const key of chunkKeys) {
    newDirty.add(key)
  }
  return { ...state, dirtyChunks: newDirty }
}

/**
 * Mark all chunks as dirty (full rebuild).
 */
export function markAllDirty(state: ChunkManagerState): ChunkManagerState {
  const allKeys = new Set(state.chunks.keys())
  return { ...state, dirtyChunks: allKeys }
}

/**
 * Rebuild all dirty chunks.
 * Returns a new state with updated chunk data and cleared dirty set.
 */
export function rebuildDirtyChunks(
  state: ChunkManagerState,
  cells: ReadonlyMap<string, number>,
  stairs: ReadonlyMap<string, StairSegment>,
  overrides: ReadonlyMap<EdgeKey, EdgeClassification>,
  rules: ReadonlyArray<StructuralRule>
): ChunkManagerState {
  if (state.dirtyChunks.size === 0) return state

  const newChunks = new Map(state.chunks)

  for (const key of state.dirtyChunks) {
    const existing = newChunks.get(key)
    const coord = parseChunkKeyToCoord(key)
    const range = chunkCellRange(coord)

    // Check if any cells exist in this chunk
    const hasContent = chunkHasContent(cells, range)

    if (!hasContent) {
      // Remove empty chunks
      newChunks.delete(key)
      continue
    }

    const structure = evaluateRegion(
      cells,
      stairs,
      overrides,
      rules,
      range.minX,
      range.maxX,
      range.minZ,
      range.maxZ
    )

    const newVersion = (existing?.geometryVersion ?? 0) + 1

    newChunks.set(key, {
      key,
      coord,
      structure,
      dirty: false,
      geometryVersion: newVersion,
    })
  }

  return {
    chunks: newChunks,
    dirtyChunks: new Set(),
  }
}

/**
 * Perform a full rebuild of all chunks from the world state.
 */
export function fullRebuild(
  cells: ReadonlyMap<string, number>,
  stairs: ReadonlyMap<string, StairSegment>,
  overrides: ReadonlyMap<EdgeKey, EdgeClassification>,
  rules: ReadonlyArray<StructuralRule>
): ChunkManagerState {
  const chunks = new Map<ChunkKey, ChunkData>()

  // Find all chunks that contain cells
  const chunkCoords = new Set<string>()
  for (const [cellKeyStr] of cells) {
    const [x, z] = cellKeyStr.split(',').map(Number)
    const coord = cellToChunk(x, z)
    chunkCoords.add(chunkKey(coord.cx, coord.cz))

    // Also mark neighboring chunks (edges at chunk boundaries)
    for (const dx of [-1, 0, 1]) {
      for (const dz of [-1, 0, 1]) {
        chunkCoords.add(chunkKey(coord.cx + dx, coord.cz + dz))
      }
    }
  }

  for (const key of chunkCoords) {
    const coord = parseChunkKeyToCoord(key)
    const range = chunkCellRange(coord)

    const structure = evaluateRegion(
      cells,
      stairs,
      overrides,
      rules,
      range.minX,
      range.maxX,
      range.minZ,
      range.maxZ
    )

    // Only create chunks that have content
    if (structure.edges.length > 0 || structure.corners.length > 0) {
      chunks.set(key, {
        key,
        coord,
        structure,
        dirty: false,
        geometryVersion: 1,
      })
    }
  }

  return { chunks, dirtyChunks: new Set() }
}

/**
 * Get all structural outputs combined from all chunks.
 */
export function getAllStructures(
  state: ChunkManagerState
): StructuralOutput {
  const allEdges: StructuralOutput['edges'][number][] = []
  const allCorners: StructuralOutput['corners'][number][] = []

  for (const chunk of state.chunks.values()) {
    allEdges.push(...chunk.structure.edges)
    allCorners.push(...chunk.structure.corners)
  }

  return { edges: allEdges, corners: allCorners }
}

// --- Helpers ---

function parseChunkKeyToCoord(key: ChunkKey): ChunkCoord {
  const [cx, cz] = key.split(',').map(Number)
  return { cx, cz }
}

function chunkHasContent(
  cells: ReadonlyMap<string, number>,
  range: { minX: number; maxX: number; minZ: number; maxZ: number }
): boolean {
  // Check the chunk region plus 1-cell border
  for (let x = range.minX - 1; x <= range.maxX + 1; x++) {
    for (let z = range.minZ - 1; z <= range.maxZ + 1; z++) {
      const height = cells.get(`${x},${z}`) ?? 0
      if (height > 0) return true
    }
  }
  return false
}

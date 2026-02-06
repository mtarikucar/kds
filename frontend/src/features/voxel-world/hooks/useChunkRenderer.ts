/**
 * useChunkRenderer Hook
 *
 * Manages chunk geometry lifecycle. Tracks geometry versions
 * and provides per-chunk structural data for rendering.
 */

import { useMemo, useRef } from 'react'
import type { StructuralOutput, CellEdge, CornerClassification } from '../types/worldModel'
import type { ChunkKey } from '../types/chunks'
import { CHUNK_SIZE, cellToChunk, chunkKey } from '../types/chunks'

/**
 * Chunk render data: structural output for a single chunk.
 */
export interface ChunkRenderData {
  readonly key: ChunkKey
  readonly edges: ReadonlyArray<CellEdge>
  readonly corners: ReadonlyArray<CornerClassification>
  readonly version: number
}

/**
 * Hook that splits structural output into per-chunk render data.
 * Each chunk's data is independently memoized by version.
 */
export function useChunkRenderer(
  structuralOutput: StructuralOutput
): ReadonlyArray<ChunkRenderData> {
  const versionRef = useRef(0)

  return useMemo(() => {
    versionRef.current += 1
    const version = versionRef.current

    // Group edges by chunk
    const edgesByChunk = new Map<ChunkKey, CellEdge[]>()
    for (const edge of structuralOutput.edges) {
      const coord = cellToChunk(edge.x, edge.z)
      const key = chunkKey(coord.cx, coord.cz)
      const edges = edgesByChunk.get(key) ?? []
      edges.push(edge)
      edgesByChunk.set(key, edges)
    }

    // Group corners by chunk
    const cornersByChunk = new Map<ChunkKey, CornerClassification[]>()
    for (const corner of structuralOutput.corners) {
      // Corners sit at vertices, so they belong to the chunk of the SE cell
      const coord = cellToChunk(corner.x, corner.z)
      const key = chunkKey(coord.cx, coord.cz)
      const corners = cornersByChunk.get(key) ?? []
      corners.push(corner)
      cornersByChunk.set(key, corners)
    }

    // Collect all chunk keys
    const allKeys = new Set([
      ...edgesByChunk.keys(),
      ...cornersByChunk.keys(),
    ])

    const chunks: ChunkRenderData[] = []
    for (const key of allKeys) {
      chunks.push({
        key,
        edges: edgesByChunk.get(key) ?? [],
        corners: cornersByChunk.get(key) ?? [],
        version,
      })
    }

    return chunks
  }, [structuralOutput])
}

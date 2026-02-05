/**
 * Railing Generator
 *
 * Automatically generates railings on open edges at upper levels (balcony style).
 * Railings appear where:
 * 1. Cell height >= 2 (upper floors)
 * 2. Neighbor height < current level at that edge
 * 3. No stair exists at that edge
 */

import type { RailingSegment, StairSegment, StairSide } from '../../types/voxel'
import { cellKey, parseKey } from './floorCellManager'
import { hasStairAtEdge } from './stairGenerator'

/**
 * Railing height (waist height)
 */
export const RAILING_HEIGHT = 0.4

/**
 * Railing post thickness
 */
export const RAILING_POST_THICKNESS = 0.02

/**
 * Space between railing posts
 */
export const RAILING_POST_SPACING = 0.2

/**
 * Railing color (dark gray)
 */
export const RAILING_COLOR = '#4a4a4a'

/**
 * Top rail thickness
 */
export const RAILING_TOP_THICKNESS = 0.03

/**
 * Interface for railing edge data (before merging)
 */
interface RailingEdge {
  x: number
  z: number
  level: number
  side: StairSide
}

/**
 * Find all edges that need railings
 */
function findRailingEdges(
  floorCells: Map<string, number>,
  stairs: Map<string, StairSegment>
): RailingEdge[] {
  const edges: RailingEdge[] = []

  for (const [key, height] of floorCells) {
    if (height < 2) continue // Only upper levels get railings

    const { x, z } = parseKey(key)

    // Check each direction for the TOP level of this cell
    const level = height // Railing goes on the top floor
    const sides: StairSide[] = ['n', 's', 'e', 'w']

    for (const side of sides) {
      // Get neighbor position
      const neighbor = getNeighborForSide(x, z, side)
      const neighborHeight = floorCells.get(cellKey(neighbor.x, neighbor.z)) ?? 0

      // Need railing if neighbor doesn't reach this level
      if (neighborHeight < level) {
        // Check if there's a stair at this edge
        // Stairs can exist at the level below (connecting level-1 to level)
        const stairLevel = level - 1
        if (!hasStairAtEdge(stairs, x, z, stairLevel, side)) {
          edges.push({ x, z, level, side })
        }
      }
    }
  }

  return edges
}

/**
 * Get neighbor coordinates for a given side
 */
function getNeighborForSide(
  x: number,
  z: number,
  side: StairSide
): { x: number; z: number } {
  switch (side) {
    case 'n':
      return { x, z: z - 1 }
    case 's':
      return { x, z: z + 1 }
    case 'e':
      return { x: x + 1, z }
    case 'w':
      return { x: x - 1, z }
  }
}

/**
 * Merge adjacent railing edges into segments
 */
function mergeRailingEdges(edges: RailingEdge[]): RailingSegment[] {
  if (edges.length === 0) return []

  const segments: RailingSegment[] = []

  // Group by level and side
  const groups = new Map<string, RailingEdge[]>()
  for (const edge of edges) {
    const key = `${edge.level}-${edge.side}`
    const group = groups.get(key) || []
    group.push(edge)
    groups.set(key, group)
  }

  let segmentId = 0

  for (const [, group] of groups) {
    const side = group[0].side
    const level = group[0].level

    // Sort edges for merging
    if (side === 'n' || side === 's') {
      // Horizontal railings: sort by z then x
      group.sort((a, b) => {
        if (a.z !== b.z) return a.z - b.z
        return a.x - b.x
      })
    } else {
      // Vertical railings: sort by x then z
      group.sort((a, b) => {
        if (a.x !== b.x) return a.x - b.x
        return a.z - b.z
      })
    }

    // Merge consecutive edges
    let i = 0
    while (i < group.length) {
      const startEdge = group[i]
      let length = 1

      // Find consecutive edges
      while (i + length < group.length) {
        const current = group[i + length - 1]
        const next = group[i + length]

        const isConsecutive =
          side === 'n' || side === 's'
            ? next.z === current.z && next.x === current.x + 1
            : next.x === current.x && next.z === current.z + 1

        if (isConsecutive) {
          length++
        } else {
          break
        }
      }

      segments.push({
        id: `railing-${segmentId++}`,
        x: startEdge.x,
        z: startEdge.z,
        level: startEdge.level,
        side: startEdge.side,
        length,
      })

      i += length
    }
  }

  return segments
}

/**
 * Generate railings from floor cells and stairs
 * Returns an array of railing segments for rendering
 */
export function generateRailings(
  floorCells: Map<string, number>,
  stairs: Map<string, StairSegment>
): RailingSegment[] {
  const edges = findRailingEdges(floorCells, stairs)
  return mergeRailingEdges(edges)
}

/**
 * Interface for railing post geometry
 */
export interface RailingPostGeometry {
  position: [number, number, number]
  height: number
}

/**
 * Interface for railing top rail geometry
 */
export interface RailingTopGeometry {
  start: [number, number, number]
  end: [number, number, number]
}

/**
 * Compute railing posts positions for a segment
 */
export function computeRailingPosts(railing: RailingSegment): RailingPostGeometry[] {
  const posts: RailingPostGeometry[] = []

  // Base Y position (on top of the floor at this level)
  const baseY = (railing.level - 1) * 1 + 1 // Level is 1-indexed, each level is 1 unit

  // Calculate number of posts based on length and spacing
  const totalLength = railing.length
  const numPosts = Math.ceil(totalLength / RAILING_POST_SPACING) + 1

  for (let i = 0; i < numPosts; i++) {
    const offset = Math.min(i * RAILING_POST_SPACING, totalLength)

    let postX: number
    let postZ: number

    switch (railing.side) {
      case 'n':
        postX = railing.x + offset
        postZ = railing.z
        break
      case 's':
        postX = railing.x + offset
        postZ = railing.z + 1
        break
      case 'e':
        postX = railing.x + 1
        postZ = railing.z + offset
        break
      case 'w':
        postX = railing.x
        postZ = railing.z + offset
        break
    }

    posts.push({
      position: [postX, baseY + RAILING_HEIGHT / 2, postZ],
      height: RAILING_HEIGHT,
    })
  }

  return posts
}

/**
 * Compute top rail geometry for a segment
 */
export function computeRailingTop(railing: RailingSegment): RailingTopGeometry {
  const baseY = (railing.level - 1) * 1 + 1 + RAILING_HEIGHT

  let start: [number, number, number]
  let end: [number, number, number]

  switch (railing.side) {
    case 'n':
      start = [railing.x, baseY, railing.z]
      end = [railing.x + railing.length, baseY, railing.z]
      break
    case 's':
      start = [railing.x, baseY, railing.z + 1]
      end = [railing.x + railing.length, baseY, railing.z + 1]
      break
    case 'e':
      start = [railing.x + 1, baseY, railing.z]
      end = [railing.x + 1, baseY, railing.z + railing.length]
      break
    case 'w':
      start = [railing.x, baseY, railing.z]
      end = [railing.x, baseY, railing.z + railing.length]
      break
  }

  return { start, end }
}

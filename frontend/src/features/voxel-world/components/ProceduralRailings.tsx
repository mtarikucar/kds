/**
 * ProceduralRailings Component
 *
 * Automatically generates and renders railings on open edges at upper levels.
 * Creates a balcony-style railing with vertical posts and a horizontal top rail.
 */

import { useMemo } from 'react'
import * as THREE from 'three'
import { useVoxelStore } from '../store/voxelStore'
import type { RailingSegment } from '../types/voxel'
import {
  generateRailings,
  computeRailingPosts,
  computeRailingTop,
  RAILING_COLOR,
  RAILING_POST_THICKNESS,
  RAILING_TOP_THICKNESS,
  RAILING_HEIGHT,
} from '../utils/procedural/railingGenerator'

interface ProceduralRailingsProps {
  color?: string
}

export function ProceduralRailings({ color = RAILING_COLOR }: ProceduralRailingsProps) {
  const floorCells = useVoxelStore((state) => state.floorCells)
  const stairs = useVoxelStore((state) => state.stairs)

  // Generate railings from floor cells and stairs
  const railings = useMemo(() => {
    return generateRailings(floorCells, stairs)
  }, [floorCells, stairs])

  // Create shared material
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.3,
      metalness: 0.5,
    })
  }, [color])

  if (railings.length === 0) {
    return null
  }

  return (
    <group>
      {railings.map((railing) => (
        <RailingMesh key={railing.id} railing={railing} material={material} />
      ))}
    </group>
  )
}

interface RailingMeshProps {
  railing: RailingSegment
  material: THREE.Material
}

function RailingMesh({ railing, material }: RailingMeshProps) {
  const posts = useMemo(() => computeRailingPosts(railing), [railing])
  const topRail = useMemo(() => computeRailingTop(railing), [railing])

  // Geometry for posts
  const postGeometry = useMemo(() => {
    return new THREE.BoxGeometry(
      RAILING_POST_THICKNESS,
      RAILING_HEIGHT,
      RAILING_POST_THICKNESS
    )
  }, [])

  // Calculate top rail length and geometry
  const topRailLength = useMemo(() => {
    const dx = topRail.end[0] - topRail.start[0]
    const dz = topRail.end[2] - topRail.start[2]
    return Math.sqrt(dx * dx + dz * dz)
  }, [topRail])

  const topRailGeometry = useMemo(() => {
    // Determine if horizontal (along x) or vertical (along z)
    const isHorizontal = Math.abs(topRail.end[0] - topRail.start[0]) > 0.01
    if (isHorizontal) {
      return new THREE.BoxGeometry(topRailLength, RAILING_TOP_THICKNESS, RAILING_TOP_THICKNESS)
    }
    return new THREE.BoxGeometry(RAILING_TOP_THICKNESS, RAILING_TOP_THICKNESS, topRailLength)
  }, [topRailLength, topRail])

  // Top rail position (center)
  const topRailPosition: [number, number, number] = useMemo(() => {
    return [
      (topRail.start[0] + topRail.end[0]) / 2,
      topRail.start[1],
      (topRail.start[2] + topRail.end[2]) / 2,
    ]
  }, [topRail])

  return (
    <group>
      {/* Vertical posts */}
      {posts.map((post, index) => (
        <mesh
          key={`${railing.id}-post-${index}`}
          position={post.position}
          geometry={postGeometry}
          material={material}
          castShadow
          receiveShadow
        />
      ))}

      {/* Top horizontal rail */}
      <mesh
        position={topRailPosition}
        geometry={topRailGeometry}
        material={material}
        castShadow
        receiveShadow
      />
    </group>
  )
}

export default ProceduralRailings

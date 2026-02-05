/**
 * ProceduralStairs Component
 *
 * Renders stairs that connect different floor levels.
 * Each stair consists of multiple box steps forming a staircase.
 */

import { useMemo } from 'react'
import * as THREE from 'three'
import { useVoxelStore } from '../store/voxelStore'
import type { StairSegment } from '../types/voxel'
import {
  computeStairGeometry,
  STAIR_COLOR,
  STEP_HEIGHT,
} from '../utils/procedural/stairGenerator'

interface ProceduralStairsProps {
  color?: string
}

export function ProceduralStairs({ color = STAIR_COLOR }: ProceduralStairsProps) {
  const stairs = useVoxelStore((state) => state.stairs)

  // Create shared material
  const material = useMemo(() => {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.5,
      metalness: 0,
    })
  }, [color])

  if (stairs.size === 0) {
    return null
  }

  return (
    <group>
      {Array.from(stairs.values()).map((stair) => (
        <StairMesh key={stair.id} stair={stair} material={material} />
      ))}
    </group>
  )
}

interface StairMeshProps {
  stair: StairSegment
  material: THREE.Material
}

function StairMesh({ stair, material }: StairMeshProps) {
  const steps = useMemo(() => computeStairGeometry(stair), [stair])

  // Create geometries for each step
  const stepGeometries = useMemo(() => {
    return steps.map((step) => {
      return new THREE.BoxGeometry(step.size[0], step.size[1], step.size[2])
    })
  }, [steps])

  return (
    <group>
      {steps.map((step, index) => (
        <mesh
          key={`${stair.id}-step-${index}`}
          position={step.position}
          geometry={stepGeometries[index]}
          material={material}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  )
}

export default ProceduralStairs

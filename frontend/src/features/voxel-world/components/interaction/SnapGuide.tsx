import { useMemo } from 'react'
import type { SnapGuide as SnapGuideType, WorldDimensions } from '../../types/voxel'

interface SnapGuideProps {
  guide: SnapGuideType
  worldDimensions: WorldDimensions
}

const GUIDE_COLORS = {
  grid: '#9CA3AF',
  edge: '#3B82F6',
  center: '#10B981',
}

export function SnapGuide({ guide, worldDimensions }: SnapGuideProps) {
  const color = GUIDE_COLORS[guide.type]

  const points = useMemo(() => {
    const y = 0.05 // Slightly above ground
    if (guide.axis === 'x') {
      return new Float32Array([
        guide.position, y, 0,
        guide.position, y, worldDimensions.depth,
      ])
    } else {
      return new Float32Array([
        0, y, guide.position,
        worldDimensions.width, y, guide.position,
      ])
    }
  }, [guide, worldDimensions])

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={2}
          array={points}
          itemSize={3}
        />
      </bufferGeometry>
      <lineDashedMaterial
        color={color}
        dashSize={0.2}
        gapSize={0.1}
        opacity={0.7}
        transparent
      />
    </line>
  )
}

interface SnapGuidesProps {
  guides: SnapGuideType[]
  worldDimensions: WorldDimensions
}

export function SnapGuides({ guides, worldDimensions }: SnapGuidesProps) {
  if (guides.length === 0) return null

  return (
    <group>
      {guides.map((guide, index) => (
        <SnapGuide
          key={`${guide.axis}-${guide.position}-${index}`}
          guide={guide}
          worldDimensions={worldDimensions}
        />
      ))}
    </group>
  )
}

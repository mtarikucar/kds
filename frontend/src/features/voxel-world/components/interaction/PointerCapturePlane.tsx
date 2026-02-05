import type { VoxelPosition } from '../../types/voxel'

interface PointerCapturePlaneProps {
  width: number
  depth: number
  onPointerMove: (worldPosition: VoxelPosition) => void
  onPointerUp: () => void
  enabled: boolean
}

/**
 * Invisible plane that captures pointer events during manipulation
 * This solves the issue where R3F pointer events don't bubble to window
 */
export function PointerCapturePlane({
  width,
  depth,
  onPointerMove,
  onPointerUp,
  enabled,
}: PointerCapturePlaneProps) {
  if (!enabled) return null

  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[width / 2, 0.01, depth / 2]}
      onPointerMove={(e) => {
        e.stopPropagation()
        const point = e.point
        onPointerMove({ x: point.x, y: 0, z: point.z })
      }}
      onPointerUp={(e) => {
        e.stopPropagation()
        onPointerUp()
      }}
    >
      <planeGeometry args={[width * 2, depth * 2]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  )
}

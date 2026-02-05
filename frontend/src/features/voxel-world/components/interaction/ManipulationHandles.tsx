import { useMemo } from 'react'
import type { VoxelObject, HandleId } from '../../types/voxel'
import { HandleMesh } from './HandleMesh'

interface ManipulationHandlesProps {
  object: VoxelObject
  onHandlePointerDown?: (handleId: HandleId) => void
  onHandlePointerUp?: (handleId: HandleId) => void
  activeHandle?: HandleId | null
  showRotateHandle?: boolean
}

export function ManipulationHandles({
  object,
  onHandlePointerDown,
  onHandlePointerUp,
  activeHandle,
  showRotateHandle = true,
}: ManipulationHandlesProps) {
  const handlePositions = useMemo(() => {
    const width = (object.metadata?.width as number) ?? 1
    const depth = (object.metadata?.depth as number) ?? 1
    const x = object.position.x
    const z = object.position.z
    const y = 0.1 // Slightly above ground

    // Calculate center and edges
    const cx = x + width / 2
    const cz = z + depth / 2

    return {
      // Edge handles (N, S, E, W)
      n: [cx, y, z] as [number, number, number],
      s: [cx, y, z + depth] as [number, number, number],
      e: [x + width, y, cz] as [number, number, number],
      w: [x, y, cz] as [number, number, number],
      // Corner handles (NE, NW, SE, SW)
      ne: [x + width, y, z] as [number, number, number],
      nw: [x, y, z] as [number, number, number],
      se: [x + width, y, z + depth] as [number, number, number],
      sw: [x, y, z + depth] as [number, number, number],
      // Center handle (for move)
      center: [cx, 0.3, cz] as [number, number, number],
      // Rotation handle (above center)
      rotate: [cx, 1.5, cz] as [number, number, number],
    }
  }, [object])

  return (
    <group>
      {/* Edge handles - single axis resize */}
      <HandleMesh
        id="n"
        position={handlePositions.n}
        onPointerDown={onHandlePointerDown}
        onPointerUp={onHandlePointerUp}
        isActive={activeHandle === 'n'}
      />
      <HandleMesh
        id="s"
        position={handlePositions.s}
        onPointerDown={onHandlePointerDown}
        onPointerUp={onHandlePointerUp}
        isActive={activeHandle === 's'}
      />
      <HandleMesh
        id="e"
        position={handlePositions.e}
        onPointerDown={onHandlePointerDown}
        onPointerUp={onHandlePointerUp}
        isActive={activeHandle === 'e'}
      />
      <HandleMesh
        id="w"
        position={handlePositions.w}
        onPointerDown={onHandlePointerDown}
        onPointerUp={onHandlePointerUp}
        isActive={activeHandle === 'w'}
      />

      {/* Corner handles - dual axis resize */}
      <HandleMesh
        id="ne"
        position={handlePositions.ne}
        onPointerDown={onHandlePointerDown}
        onPointerUp={onHandlePointerUp}
        isActive={activeHandle === 'ne'}
      />
      <HandleMesh
        id="nw"
        position={handlePositions.nw}
        onPointerDown={onHandlePointerDown}
        onPointerUp={onHandlePointerUp}
        isActive={activeHandle === 'nw'}
      />
      <HandleMesh
        id="se"
        position={handlePositions.se}
        onPointerDown={onHandlePointerDown}
        onPointerUp={onHandlePointerUp}
        isActive={activeHandle === 'se'}
      />
      <HandleMesh
        id="sw"
        position={handlePositions.sw}
        onPointerDown={onHandlePointerDown}
        onPointerUp={onHandlePointerUp}
        isActive={activeHandle === 'sw'}
      />

      {/* Center handle - for move */}
      <HandleMesh
        id="center"
        position={handlePositions.center}
        onPointerDown={onHandlePointerDown}
        onPointerUp={onHandlePointerUp}
        isActive={activeHandle === 'center'}
      />

      {/* Rotation handle */}
      {showRotateHandle && (
        <HandleMesh
          id="rotate"
          position={handlePositions.rotate}
          onPointerDown={onHandlePointerDown}
          onPointerUp={onHandlePointerUp}
          isActive={activeHandle === 'rotate'}
        />
      )}

      {/* Visual connection line to rotate handle */}
      {showRotateHandle && (
        <line>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={2}
              array={new Float32Array([
                handlePositions.rotate[0], 0.3, handlePositions.rotate[2],
                handlePositions.rotate[0], 1.2, handlePositions.rotate[2],
              ])}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color="#10B981" opacity={0.5} transparent />
        </line>
      )}
    </group>
  )
}

import { useRef, useEffect } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useVoxelStore } from '../../store/voxelStore'
import { DEFAULT_WORLD_DIMENSIONS } from '../../types/voxel'

interface OrbitCameraProps {
  enabled?: boolean
  isometric?: boolean
}

export function OrbitCamera({ enabled = true, isometric = false }: OrbitCameraProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const { camera } = useThree()
  const layout = useVoxelStore((state) => state.layout)
  const isDragging = useVoxelStore((state) => state.isDragging)

  const dimensions = layout?.dimensions ?? DEFAULT_WORLD_DIMENSIONS
  const centerX = dimensions.width / 2
  const centerZ = dimensions.depth / 2

  // Set up isometric camera position
  useEffect(() => {
    if (isometric && camera) {
      // Isometric view from top-right corner
      // Standard isometric angle is ~35.264° (arctan(1/√2)) for polar angle
      const distance = Math.max(dimensions.width, dimensions.depth) * 1.2
      const height = distance * 0.8

      // Position camera at top-right (positive X and Z)
      camera.position.set(
        centerX + distance * 0.7,
        height,
        centerZ + distance * 0.7
      )
      camera.lookAt(centerX, 0, centerZ)
      camera.updateProjectionMatrix()
    }
  }, [isometric, camera, centerX, centerZ, dimensions.width, dimensions.depth])

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.target.set(centerX, 0, centerZ)
      controlsRef.current.update()
    }
  }, [centerX, centerZ])

  // Isometric mode: fixed angle, only zoom and pan allowed
  if (isometric) {
    return (
      <OrbitControls
        ref={controlsRef}
        enabled={enabled && !isDragging}
        enablePan={true}
        enableZoom={true}
        enableRotate={false}
        minDistance={10}
        maxDistance={150}
        panSpeed={0.8}
        zoomSpeed={1}
        target={[centerX, 0, centerZ]}
        makeDefault
      />
    )
  }

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={enabled && !isDragging}
      enablePan={true}
      enableZoom={true}
      enableRotate={true}
      minDistance={5}
      maxDistance={100}
      minPolarAngle={0.1}
      maxPolarAngle={Math.PI / 2.2}
      panSpeed={0.8}
      rotateSpeed={0.5}
      zoomSpeed={1}
      target={[centerX, 0, centerZ]}
      makeDefault
    />
  )
}

import { useRef, useEffect } from 'react'
import { OrbitControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

interface IsometricCameraProps {
  target?: [number, number, number]
  distance?: number
  enablePan?: boolean
  enableZoom?: boolean
}

export function IsometricCamera({
  target = [0, 0, 0],
  distance = 30,
  enablePan = true,
  enableZoom = true,
}: IsometricCameraProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const { camera } = useThree()

  // Set up isometric camera position - fixed angle from top-right
  useEffect(() => {
    // Standard isometric angle from top-right corner
    // Azimuth: 45 degrees (π/4) - looking from corner
    // Polar: ~35.264 degrees (arctan(1/√2)) - standard isometric
    const azimuth = Math.PI / 1.5 // 45 degrees
    const polar = Math.atan(1 / Math.sqrt(0.2)) // ~35.264 degrees

    const x = target[0] + distance * Math.sin(polar) * Math.cos(azimuth)
    const y = target[1] + distance * Math.cos(polar)
    const z = target[2] + distance * Math.sin(polar) * Math.sin(azimuth)

    camera.position.set(x, y, z)
    camera.lookAt(target[0], target[1], target[2])
    camera.updateProjectionMatrix()
  }, [camera, target, distance])

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.target.set(target[0], target[1], target[2])
      controlsRef.current.update()
    }
  }, [target])

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={true}
      enablePan={enablePan}
      enableZoom={enableZoom}
      enableRotate={true}
      // Limit vertical angle to maintain good viewing perspective (20° to 70° from vertical)
      minPolarAngle={0.35}
      maxPolarAngle={1.2}
      minDistance={15}
      maxDistance={80}
      panSpeed={0.8}
      rotateSpeed={0.5}
      zoomSpeed={1}
      target={target}
      makeDefault
    />
  )
}

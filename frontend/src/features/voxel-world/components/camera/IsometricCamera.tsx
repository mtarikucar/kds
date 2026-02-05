import { useRef, useEffect, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

interface IsometricCameraProps {
  target?: [number, number, number]
  distance?: number
  enableZoom?: boolean
}

export function IsometricCamera({
  target = [0, 0, 0],
  distance = 30,
  enableZoom = true,
}: IsometricCameraProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const { camera, gl } = useThree()
  const isInitializedRef = useRef(false)
  const prevTargetRef = useRef<string>('')
  const prevDistanceRef = useRef<number>(0)

  // Drag state refs (not state to avoid re-renders)
  const isDraggingRef = useRef(false)
  const dragTypeRef = useRef<'none' | 'pan' | 'rotate'>('none')
  const lastMouseRef = useRef({ x: 0, y: 0 })

  // Track canvas and pointer capture for proper cleanup
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const capturedPointerIdRef = useRef<number | null>(null)

  // Set up isometric camera position
  useEffect(() => {
    const targetKey = `${target[0]}-${target[1]}-${target[2]}`
    const hasTargetChanged = prevTargetRef.current !== targetKey
    const hasDistanceChanged = prevDistanceRef.current !== distance

    if (!isInitializedRef.current || hasTargetChanged || hasDistanceChanged) {
      const azimuth = Math.PI / 1.5
      const polar = Math.atan(1 / Math.sqrt(0.2))

      const x = target[0] + distance * Math.sin(polar) * Math.cos(azimuth)
      const y = target[1] + distance * Math.cos(polar)
      const z = target[2] + distance * Math.sin(polar) * Math.sin(azimuth)

      camera.position.set(x, y, z)
      camera.lookAt(target[0], target[1], target[2])
      camera.updateProjectionMatrix()

      prevTargetRef.current = targetKey
      prevDistanceRef.current = distance
      isInitializedRef.current = true
    }
  }, [camera, target, distance])

  // Update controls target
  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.target.set(target[0], target[1], target[2])
      controlsRef.current.update()
    }
  }, [target])

  // Custom pointer event handlers
  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      // Middle button = PAN
      if (e.button === 1) {
        e.preventDefault()
        isDraggingRef.current = true
        dragTypeRef.current = 'pan'
        lastMouseRef.current = { x: e.clientX, y: e.clientY }
        capturedPointerIdRef.current = e.pointerId
        gl.domElement.setPointerCapture(e.pointerId)
        return
      }

      // Shift + Left button = ROTATE
      if (e.button === 0 && e.shiftKey) {
        e.preventDefault()
        isDraggingRef.current = true
        dragTypeRef.current = 'rotate'
        lastMouseRef.current = { x: e.clientX, y: e.clientY }
        capturedPointerIdRef.current = e.pointerId
        gl.domElement.setPointerCapture(e.pointerId)
        return
      }

      // Left button without shift = let InteractiveGrid handle
    },
    [gl.domElement]
  )

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (!isDraggingRef.current || !controlsRef.current) return

      const deltaX = e.clientX - lastMouseRef.current.x
      const deltaY = e.clientY - lastMouseRef.current.y
      lastMouseRef.current = { x: e.clientX, y: e.clientY }

      const controls = controlsRef.current

      if (dragTypeRef.current === 'pan') {
        // Manual pan calculation
        const panSpeed = 0.002 * controls.target.distanceTo(camera.position)
        const offset = new THREE.Vector3()

        // Get camera right and up vectors
        const right = new THREE.Vector3()
        const up = new THREE.Vector3()
        camera.matrix.extractBasis(right, up, new THREE.Vector3())

        offset.addScaledVector(right, -deltaX * panSpeed)
        offset.addScaledVector(up, deltaY * panSpeed)

        controls.target.add(offset)
        camera.position.add(offset)
        controls.update()
      } else if (dragTypeRef.current === 'rotate') {
        // Use spherical coordinates for rotation
        const rotateSpeed = 0.005

        // Azimuth (horizontal) rotation
        const azimuthAngle = deltaX * rotateSpeed
        // Polar (vertical) rotation
        const polarAngle = deltaY * rotateSpeed

        // Get spherical coordinates
        const offset = new THREE.Vector3()
        offset.copy(camera.position).sub(controls.target)

        const spherical = new THREE.Spherical()
        spherical.setFromVector3(offset)

        spherical.theta -= azimuthAngle
        spherical.phi += polarAngle

        // Clamp polar angle (same as OrbitControls limits)
        spherical.phi = Math.max(0.17, Math.min(1.4, spherical.phi))

        offset.setFromSpherical(spherical)
        camera.position.copy(controls.target).add(offset)
        camera.lookAt(controls.target)
        controls.update()
      }
    },
    [camera]
  )

  const handlePointerUp = useCallback(
    (e: PointerEvent) => {
      if (isDraggingRef.current) {
        gl.domElement.releasePointerCapture(e.pointerId)
        capturedPointerIdRef.current = null
        isDraggingRef.current = false
        dragTypeRef.current = 'none'
      }
    },
    [gl.domElement]
  )

  // Prevent context menu on middle click
  const handleContextMenu = useCallback((e: MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault()
    }
  }, [])

  // Attach event listeners to canvas
  useEffect(() => {
    const canvas = gl.domElement
    canvasRef.current = canvas

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('pointerleave', handlePointerUp)
    canvas.addEventListener('contextmenu', handleContextMenu)

    return () => {
      const canvasToClean = canvasRef.current
      if (canvasToClean) {
        canvasToClean.removeEventListener('pointerdown', handlePointerDown)
        canvasToClean.removeEventListener('pointermove', handlePointerMove)
        canvasToClean.removeEventListener('pointerup', handlePointerUp)
        canvasToClean.removeEventListener('pointerleave', handlePointerUp)
        canvasToClean.removeEventListener('contextmenu', handleContextMenu)

        // Release pointer capture if component unmounts during drag
        if (capturedPointerIdRef.current !== null) {
          try {
            canvasToClean.releasePointerCapture(capturedPointerIdRef.current)
          } catch {
            // Pointer may already be released
          }
          capturedPointerIdRef.current = null
        }
      }
      isDraggingRef.current = false
      dragTypeRef.current = 'none'
    }
  }, [
    gl.domElement,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleContextMenu,
  ])

  // Controls:
  // - Left drag (no shift): Floor editing (InteractiveGrid)
  // - Shift + Left drag: ROTATE (custom handler)
  // - Middle drag: PAN (custom handler)
  // - Scroll: ZOOM (OrbitControls)

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={true}
      enablePan={false} // Disabled - we handle manually
      enableRotate={false} // Disabled - we handle manually
      enableZoom={enableZoom}
      minDistance={10}
      maxDistance={100}
      zoomSpeed={1.2}
      target={target}
      makeDefault
    />
  )
}

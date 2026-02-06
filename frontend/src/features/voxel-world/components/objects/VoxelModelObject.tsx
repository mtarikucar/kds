import React, { useRef, useEffect, useState, useMemo, Suspense, Component } from 'react'
import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { VoxelPosition, VoxelRotation, ModelConfig } from '../../types/voxel'
import { VOXEL_COLORS } from '../../types/voxel'
import { ModelLoadingPlaceholder } from './ModelLoadingPlaceholder'
import { useVoxelStore } from '../../store/voxelStore'

interface VoxelModelObjectProps {
  id: string
  position: VoxelPosition
  rotation: VoxelRotation
  modelConfig: ModelConfig
  isSelected: boolean
  isEditorMode: boolean
  onClick?: () => void
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

interface ModelRendererProps {
  modelUrl: string
  scale: number
  activeAnimation?: string
  animationSpeed?: number
  animationLoop?: boolean
}

function ModelRenderer({
  modelUrl,
  scale,
}: ModelRendererProps) {
  const { scene } = useGLTF(modelUrl)

  const processedScene = useMemo(() => {
    const clone = scene.clone()
    clone.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
        // Clone material to avoid shared material issues
        if (child.material) {
          child.material = (child.material as THREE.Material).clone()
        }
      }
    })
    return clone
  }, [scene])

  return (
    <group scale={scale} position-y={scale * 0.5}>
      <primitive object={processedScene} />
    </group>
  )
}

function ModelErrorFallback({ size = 1 }: { size?: number }) {
  return (
    <mesh>
      <boxGeometry args={[size, size, size]} />
      <meshStandardMaterial
        color="#ef4444"
        transparent
        opacity={0.7}
      />
    </mesh>
  )
}

export function VoxelModelObject({
  id,
  position,
  rotation,
  modelConfig,
  isSelected,
  isEditorMode,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: VoxelModelObjectProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef<{ x: number; z: number } | null>(null)

  const { camera, raycaster, gl } = useThree()
  const editorTool = useVoxelStore((state) => state.editorTool)
  const moveObject = useVoxelStore((state) => state.moveObject)
  const setDragging = useVoxelStore((state) => state.setDragging)

  const scale = modelConfig.scale ?? 1

  const handlePointerEnter = () => {
    if (isEditorMode && editorTool === 'move') {
      gl.domElement.style.cursor = 'grab'
    } else {
      document.body.style.cursor = 'pointer'
    }
    onPointerEnter?.()
  }

  const handlePointerLeave = () => {
    if (!isDragging) {
      gl.domElement.style.cursor = 'auto'
      document.body.style.cursor = 'auto'
    }
    onPointerLeave?.()
  }

  const handlePointerDown = (e: any) => {
    if (!isEditorMode || editorTool !== 'move' || !isSelected) return
    e.stopPropagation()
    setIsDragging(true)
    setDragging(true)
    gl.domElement.style.cursor = 'grabbing'
    dragStart.current = { x: position.x, z: position.z }
  }

  const handlePointerUp = () => {
    if (isDragging) {
      setIsDragging(false)
      setDragging(false)
      gl.domElement.style.cursor = isEditorMode && editorTool === 'move' ? 'grab' : 'auto'
      dragStart.current = null
    }
  }

  const handlePointerMove = (e: any) => {
    if (!isDragging || !dragStart.current) return
    e.stopPropagation()

    // Get intersection with floor plane
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const intersectPoint = new THREE.Vector3()
    raycaster.ray.intersectPlane(floorPlane, intersectPoint)

    if (intersectPoint) {
      const newX = Math.round(intersectPoint.x)
      const newZ = Math.round(intersectPoint.z)

      if (newX !== position.x || newZ !== position.z) {
        moveObject(id, { x: newX, y: 0, z: newZ })
      }
    }
  }

  useEffect(() => {
    if (isDragging) {
      const handleGlobalPointerUp = () => handlePointerUp()
      window.addEventListener('pointerup', handleGlobalPointerUp)
      return () => window.removeEventListener('pointerup', handleGlobalPointerUp)
    }
  }, [isDragging])

  const highlightSize = { width: scale + 0.2, height: scale + 0.2, depth: scale + 0.2 }

  return (
    <group
      ref={groupRef}
      position={[position.x, position.y, position.z]}
      rotation={[0, (rotation.y * Math.PI) / 180, 0]}
      onClick={onClick}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
    >
      <Suspense fallback={<ModelLoadingPlaceholder position={{ x: 0, y: 0, z: 0 }} size={scale} />}>
        <ModelRenderer
          modelUrl={modelConfig.modelUrl}
          scale={scale}
        />
      </Suspense>

      {isSelected && isEditorMode && (
        <mesh position={[0, scale * 0.5, 0]}>
          <boxGeometry args={[highlightSize.width, highlightSize.height, highlightSize.depth]} />
          <meshBasicMaterial
            color={VOXEL_COLORS.selected}
            transparent
            opacity={0.3}
            wireframe
          />
        </mesh>
      )}
    </group>
  )
}

interface ErrorBoundaryProps {
  children: React.ReactNode
  onError: () => void
}

interface ErrorBoundaryState {
  hasError: boolean
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(): void {
    this.props.onError()
  }

  render() {
    if (this.state.hasError) {
      return null
    }
    return this.props.children
  }
}

import { useRef, useState } from 'react'
import type { Mesh } from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import type { HandleId } from '../../types/voxel'

interface HandleMeshProps {
  id: HandleId
  position: [number, number, number]
  onPointerDown?: (id: HandleId) => void
  onPointerUp?: (id: HandleId) => void
  isActive?: boolean
  color?: string
  hoverColor?: string
  size?: number
}

const HANDLE_COLORS = {
  default: '#3B82F6',
  hover: '#60A5FA',
  active: '#2563EB',
  rotate: '#10B981',
  rotateHover: '#34D399',
  center: '#F59E0B',
  centerHover: '#FBBF24',
}

export function HandleMesh({
  id,
  position,
  onPointerDown,
  onPointerUp,
  isActive = false,
  color,
  hoverColor,
  size = 0.15,
}: HandleMeshProps) {
  const meshRef = useRef<Mesh>(null)
  const [isHovered, setIsHovered] = useState(false)

  const isRotateHandle = id === 'rotate'
  const isCenterHandle = id === 'center'
  const defaultColor = isCenterHandle
    ? HANDLE_COLORS.center
    : isRotateHandle
      ? HANDLE_COLORS.rotate
      : HANDLE_COLORS.default
  const defaultHoverColor = isCenterHandle
    ? HANDLE_COLORS.centerHover
    : isRotateHandle
      ? HANDLE_COLORS.rotateHover
      : HANDLE_COLORS.hover

  const currentColor = isActive
    ? HANDLE_COLORS.active
    : isHovered
      ? (hoverColor ?? defaultHoverColor)
      : (color ?? defaultColor)

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    onPointerDown?.(id)
  }

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    onPointerUp?.(id)
  }

  // Corner handles are spheres, edge handles are boxes, rotate is a torus, center is a move cross
  if (isRotateHandle) {
    return (
      <mesh
        ref={meshRef}
        position={position}
        rotation={[Math.PI / 2, 0, 0]}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => setIsHovered(false)}
      >
        <torusGeometry args={[size * 2, size * 0.3, 8, 24]} />
        <meshStandardMaterial
          color={currentColor}
          emissive={currentColor}
          emissiveIntensity={isHovered || isActive ? 0.5 : 0.2}
          roughness={0.3}
          metalness={0.6}
        />
      </mesh>
    )
  }

  // Center handle - move cross (4 arrows)
  if (isCenterHandle) {
    return (
      <group
        position={position}
        scale={isHovered || isActive ? 1.3 : 1}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => setIsHovered(false)}
      >
        {/* Center sphere */}
        <mesh>
          <sphereGeometry args={[size * 0.8, 16, 16]} />
          <meshStandardMaterial
            color={currentColor}
            emissive={currentColor}
            emissiveIntensity={isHovered || isActive ? 0.5 : 0.2}
            roughness={0.3}
            metalness={0.6}
          />
        </mesh>
        {/* Cross bars for move indication */}
        <mesh rotation={[0, 0, 0]}>
          <boxGeometry args={[size * 3, size * 0.2, size * 0.2]} />
          <meshStandardMaterial
            color={currentColor}
            emissive={currentColor}
            emissiveIntensity={isHovered || isActive ? 0.5 : 0.2}
            roughness={0.3}
            metalness={0.6}
          />
        </mesh>
        <mesh rotation={[0, 0, 0]}>
          <boxGeometry args={[size * 0.2, size * 0.2, size * 3]} />
          <meshStandardMaterial
            color={currentColor}
            emissive={currentColor}
            emissiveIntensity={isHovered || isActive ? 0.5 : 0.2}
            roughness={0.3}
            metalness={0.6}
          />
        </mesh>
      </group>
    )
  }

  // Determine if corner or edge handle
  const isCorner = ['ne', 'nw', 'se', 'sw'].includes(id)

  return (
    <mesh
      ref={meshRef}
      position={position}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      scale={isHovered || isActive ? 1.3 : 1}
    >
      {isCorner ? (
        <sphereGeometry args={[size, 16, 16]} />
      ) : (
        <boxGeometry args={[size * 1.5, size * 0.5, size * 1.5]} />
      )}
      <meshStandardMaterial
        color={currentColor}
        emissive={currentColor}
        emissiveIntensity={isHovered || isActive ? 0.5 : 0.2}
        roughness={0.3}
        metalness={0.6}
      />
    </mesh>
  )
}

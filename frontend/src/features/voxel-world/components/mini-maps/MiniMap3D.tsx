import { Suspense, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { Box, ExternalLink, Loader } from 'lucide-react'
import type { RestaurantLayout, VoxelTable, VoxelModelObject as VoxelModelObjectType } from '../../types/voxel'
import { DEFAULT_WORLD_DIMENSIONS, VOXEL_COLORS } from '../../types/voxel'
import { cn } from '@/lib/utils'

// Simplified 3D components for mini-map (low detail)
function SimplifiedFloor({ width, depth }: { width: number; depth: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[width / 2, 0, depth / 2]} receiveShadow>
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial color={VOXEL_COLORS.floorTile} />
    </mesh>
  )
}

function SimplifiedTable({
  position,
  status,
}: {
  position: { x: number; y: number; z: number }
  status?: string
}) {
  const color = useMemo(() => {
    switch (status) {
      case 'occupied':
        return '#EF4444'
      case 'reserved':
        return '#F59E0B'
      default:
        return '#22C55E'
    }
  }, [status])

  return (
    <mesh position={[position.x + 1, position.y + 0.4, position.z + 1]} castShadow>
      <boxGeometry args={[2, 0.8, 2]} />
      <meshStandardMaterial color={color} />
    </mesh>
  )
}

function SimplifiedScene({ layout }: { layout: RestaurantLayout | null }) {
  const dimensions = layout?.dimensions ?? DEFAULT_WORLD_DIMENSIONS
  const objects = layout?.objects ?? []

  // Filter only tables for simplified view
  const tables = useMemo(
    () => objects.filter((obj) => obj.type === 'table'),
    [objects]
  )

  return (
    <>
      {/* Lighting - simplified */}
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, 15, 10]} intensity={0.5} />

      {/* Background */}
      <color attach="background" args={['#1a1a2e']} />

      {/* Floor */}
      <SimplifiedFloor width={dimensions.width} depth={dimensions.depth} />

      {/* Tables only (simplified) */}
      {tables.map((obj) => {
        const tableObj = obj as VoxelTable
        return (
          <SimplifiedTable
            key={obj.id}
            position={obj.position}
            status={tableObj.status}
          />
        )
      })}
    </>
  )
}

interface MiniMap3DProps {
  layout: RestaurantLayout | null
  onClick: () => void
  width?: number
  height?: number
  className?: string
}

export function MiniMap3D({
  layout,
  onClick,
  width = 200,
  height = 150,
  className,
}: MiniMap3DProps) {
  const { t } = useTranslation()
  const dimensions = layout?.dimensions ?? DEFAULT_WORLD_DIMENSIONS

  // Calculate camera position for isometric-ish view
  const cameraPosition = useMemo(() => {
    const distance = Math.max(dimensions.width, dimensions.depth) * 1.5
    return [
      dimensions.width / 2 + distance * 0.5,
      distance * 0.6,
      dimensions.depth / 2 + distance * 0.5,
    ] as [number, number, number]
  }, [dimensions])

  const cameraTarget = useMemo(
    () => [dimensions.width / 2, 0, dimensions.depth / 2] as [number, number, number],
    [dimensions]
  )

  return (
    <div
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-lg backdrop-blur-sm transition-all duration-200 hover:ring-2 hover:ring-primary/50',
        className
      )}
      style={{
        width,
        height,
        backgroundColor: 'rgba(15, 23, 42, 0.95)',
        border: '1px solid rgba(100, 116, 139, 0.5)',
      }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      aria-label={t('pos.minimap.switchTo3D', 'Switch to 3D view')}
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-2 py-1 bg-slate-800/80 backdrop-blur-sm border-b border-slate-700/50 z-10">
        <div className="flex items-center gap-1.5">
          <Box className="h-3 w-3 text-slate-400" />
          <span className="text-[10px] font-medium text-slate-400">3D</span>
        </div>
        <ExternalLink className="h-3 w-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* 3D Canvas */}
      <div className="w-full h-full pt-5">
        <Canvas
          dpr={0.5} // Low resolution for performance
          gl={{
            antialias: false,
            alpha: false,
            powerPreference: 'low-power',
          }}
        >
          <Suspense fallback={null}>
            <PerspectiveCamera
              makeDefault
              position={cameraPosition}
              fov={40}
              near={0.1}
              far={500}
            />
            <OrbitControls
              target={cameraTarget}
              enableZoom={false}
              enablePan={false}
              enableRotate={false}
              enabled={false}
            />
            <SimplifiedScene layout={layout} />
          </Suspense>
        </Canvas>
      </div>

      {/* Loading fallback */}
      <Suspense
        fallback={
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/50 pt-5">
            <Loader className="h-4 w-4 animate-spin text-slate-500" />
          </div>
        }
      >
        <div />
      </Suspense>

      {/* Click hint */}
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">
        {t('pos.minimap.clickToSwitch', 'Click to switch')}
      </div>
    </div>
  )
}

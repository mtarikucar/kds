import { Suspense, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { Loader } from 'lucide-react'

interface VoxelCanvasProps {
  children: ReactNode
  className?: string
}

function LoadingFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50">
      <div className="flex flex-col items-center gap-3">
        <Loader className="h-8 w-8 animate-spin text-primary" />
        <span className="text-sm text-gray-400">Loading 3D World...</span>
      </div>
    </div>
  )
}

export function VoxelCanvas({ children, className = '' }: VoxelCanvasProps) {
  return (
    <div className={`relative h-full w-full ${className}`}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
        }}
        camera={{
          fov: 50,
          near: 0.1,
          far: 1000,
          position: [16, 20, 32],
        }}
      >
        <Suspense fallback={null}>
          {children}
        </Suspense>
      </Canvas>
      <Suspense fallback={<LoadingFallback />}>
        <div />
      </Suspense>
    </div>
  )
}

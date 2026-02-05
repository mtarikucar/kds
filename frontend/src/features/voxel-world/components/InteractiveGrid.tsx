/**
 * InteractiveGrid Component
 *
 * Invisible plane that captures pointer events for floor cell editing.
 * - Left click: Add level (increment height)
 * - Right click: Remove level (decrement height)
 * - Shift+drag: Paint mode for multiple cells
 */

import { useCallback, useRef } from 'react'
import { type ThreeEvent } from '@react-three/fiber'
import { useVoxelStore } from '../store/voxelStore'
import { useFloorEditor } from '../hooks/useFloorEditor'

interface InteractiveGridProps {
  size?: number
  enabled?: boolean
  showGridLines?: boolean
}

export function InteractiveGrid({
  size = 64,
  enabled = true,
  showGridLines = true,
}: InteractiveGridProps) {
  const editorTool = useVoxelStore((state) => state.editorTool)
  const isFloorTool = editorTool === 'floor'

  const {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    isDragging,
  } = useFloorEditor({ maxGridSize: size })

  // Track if pointer is down
  const isPointerDown = useRef(false)

  const onPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!enabled || !isFloorTool) return

      // Shift + left click is for camera rotation, let it pass through
      if (e.nativeEvent.shiftKey) return

      // Middle button is for camera pan, let it pass through
      if (e.nativeEvent.button === 1) return

      e.stopPropagation()

      // Prevent context menu on right click
      if (e.nativeEvent.button === 2) {
        e.nativeEvent.preventDefault()
      }

      isPointerDown.current = true
      handlePointerDown(e.point, e.nativeEvent.button, e.nativeEvent.shiftKey)
    },
    [enabled, isFloorTool, handlePointerDown]
  )

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!enabled || !isFloorTool || !isPointerDown.current) return
      e.stopPropagation()
      handlePointerMove(e.point)
    },
    [enabled, isFloorTool, handlePointerMove]
  )

  const onPointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!enabled || !isFloorTool) return
      e.stopPropagation()
      isPointerDown.current = false
      handlePointerUp()
    },
    [enabled, isFloorTool, handlePointerUp]
  )

  // Prevent context menu
  const onContextMenu = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.nativeEvent.preventDefault()
    e.stopPropagation()
  }, [])

  // Don't render anything if floor tool is not active
  if (!isFloorTool && !showGridLines) return null

  return (
    <group>
      {/* Invisible interaction plane for floor editing */}
      {isFloorTool && (
        <mesh
          rotation={[-Math.PI / 2, 0, 0]}
          position={[size / 2, 0.002, size / 2]}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          onContextMenu={onContextMenu}
        >
          <planeGeometry args={[size, size]} />
          <meshBasicMaterial
            visible={false}
            transparent
            opacity={0}
          />
        </mesh>
      )}

      {/* Grid visualization */}
      {showGridLines && (
        <GridLines
          size={size}
          isActive={isFloorTool}
          isDragging={isDragging}
        />
      )}
    </group>
  )
}

interface GridLinesProps {
  size: number
  isActive: boolean
  isDragging: boolean
}

function GridLines({ size, isActive, isDragging }: GridLinesProps) {
  const opacity = isActive ? (isDragging ? 0.5 : 0.3) : 0.1
  const color = isActive ? '#3b82f6' : '#9ca3af'

  return (
    <group position={[size / 2, 0.001, size / 2]}>
      {/* Main grid */}
      <gridHelper args={[size, size, color, color]}>
        <meshBasicMaterial
          attach="material"
          color={color}
          opacity={opacity}
          transparent
        />
      </gridHelper>
    </group>
  )
}

export default InteractiveGrid

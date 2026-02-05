/**
 * useFloorEditor Hook
 *
 * Handles floor cell editing interactions for Townscaper-style layout.
 * - Left click/drag: Add height level (increment) - paint mode
 * - Right click/drag: Remove height level (decrement/delete) - erase mode
 * - Shift+drag: Camera control (handled by IsometricCamera)
 */

import { useCallback, useState, useRef } from 'react'
import type { Vector3 } from 'three'
import { useVoxelStore } from '../store/voxelStore'
import { cellKey } from '../utils/procedural/floorCellManager'

export type FloorEditMode = 'add' | 'remove'

export interface UseFloorEditorOptions {
  gridSize?: number
  maxGridSize?: number
}

export interface UseFloorEditorResult {
  // Left click handlers (add height)
  handleLeftClick: (worldPos: Vector3) => void
  // Right click handlers (remove height)
  handleRightClick: (worldPos: Vector3) => void
  // Drag handlers
  handlePointerDown: (worldPos: Vector3, button: number, shiftKey: boolean) => void
  handlePointerMove: (worldPos: Vector3) => void
  handlePointerUp: () => void
  // State
  isDragging: boolean
  dragMode: FloorEditMode
  lastEditedCell: { x: number; z: number } | null
}

export function useFloorEditor(
  options: UseFloorEditorOptions = {}
): UseFloorEditorResult {
  const { maxGridSize = 64 } = options

  const floorCells = useVoxelStore((state) => state.floorCells)
  const incrementFloorHeight = useVoxelStore((state) => state.incrementFloorHeight)
  const decrementFloorHeight = useVoxelStore((state) => state.decrementFloorHeight)

  const [isDragging, setIsDragging] = useState(false)
  const [dragMode, setDragMode] = useState<FloorEditMode>('add')
  const [lastEditedCell, setLastEditedCell] = useState<{
    x: number
    z: number
  } | null>(null)

  // Track visited cells during drag to avoid multiple edits
  const visitedDuringDrag = useRef<Set<string>>(new Set())

  /**
   * Convert world position to grid coordinates
   */
  const worldToGrid = useCallback(
    (worldPos: Vector3): { x: number; z: number } | null => {
      const gridX = Math.floor(worldPos.x)
      const gridZ = Math.floor(worldPos.z)

      // Validate bounds
      if (gridX < 0 || gridZ < 0 || gridX >= maxGridSize || gridZ >= maxGridSize) {
        return null
      }

      return { x: gridX, z: gridZ }
    },
    [maxGridSize]
  )

  /**
   * Handle left click - increment height (add level)
   */
  const handleLeftClick = useCallback(
    (worldPos: Vector3) => {
      const gridPos = worldToGrid(worldPos)
      if (!gridPos) return

      incrementFloorHeight(gridPos.x, gridPos.z)
      setLastEditedCell(gridPos)
    },
    [worldToGrid, incrementFloorHeight]
  )

  /**
   * Handle right click - decrement height (remove level)
   */
  const handleRightClick = useCallback(
    (worldPos: Vector3) => {
      const gridPos = worldToGrid(worldPos)
      if (!gridPos) return

      decrementFloorHeight(gridPos.x, gridPos.z)
      setLastEditedCell(gridPos)
    },
    [worldToGrid, decrementFloorHeight]
  )

  /**
   * Handle pointer down - start drag/paint mode
   * button: 0 = left, 2 = right
   * If shift is held, let camera handle it (don't start editing)
   */
  const handlePointerDown = useCallback(
    (worldPos: Vector3, button: number, shiftKey: boolean) => {
      // Shift is for camera control, skip floor editing
      if (shiftKey) return

      const gridPos = worldToGrid(worldPos)
      if (!gridPos) return

      const isRightClick = button === 2

      // Always start drag/paint mode
      const mode: FloorEditMode = isRightClick ? 'remove' : 'add'
      setDragMode(mode)
      setIsDragging(true)
      visitedDuringDrag.current.clear()
      visitedDuringDrag.current.add(cellKey(gridPos.x, gridPos.z))

      // Apply edit to first cell
      if (isRightClick) {
        decrementFloorHeight(gridPos.x, gridPos.z)
      } else {
        incrementFloorHeight(gridPos.x, gridPos.z)
      }
      setLastEditedCell(gridPos)
    },
    [worldToGrid, incrementFloorHeight, decrementFloorHeight]
  )

  /**
   * Handle pointer move during drag
   */
  const handlePointerMove = useCallback(
    (worldPos: Vector3) => {
      if (!isDragging) return

      const gridPos = worldToGrid(worldPos)
      if (!gridPos) return

      const key = cellKey(gridPos.x, gridPos.z)

      // Skip if already visited during this drag
      if (visitedDuringDrag.current.has(key)) return

      visitedDuringDrag.current.add(key)

      if (dragMode === 'add') {
        incrementFloorHeight(gridPos.x, gridPos.z)
      } else {
        decrementFloorHeight(gridPos.x, gridPos.z)
      }
      setLastEditedCell(gridPos)
    },
    [isDragging, worldToGrid, dragMode, incrementFloorHeight, decrementFloorHeight]
  )

  /**
   * Handle pointer up - end drag
   */
  const handlePointerUp = useCallback(() => {
    if (isDragging) {
      setIsDragging(false)
      visitedDuringDrag.current.clear()
    }
  }, [isDragging])

  return {
    handleLeftClick,
    handleRightClick,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    isDragging,
    dragMode,
    lastEditedCell,
  }
}

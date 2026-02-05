import { useCallback, useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Vector2, Vector3, Raycaster, Plane } from 'three'
import { useVoxelStore } from '../store/voxelStore'
import { calculateSnap, calculateResizeSnap } from '../utils/snapEngine'
import type { HandleId, VoxelObject, VoxelPosition } from '../types/voxel'

interface UseManipulationGesturesOptions {
  enabled?: boolean
}

/**
 * Hook for managing TinyGlade-style manipulation gestures
 * Handles resize, rotate, and move operations on selected objects
 */
export function useManipulationGestures({ enabled = true }: UseManipulationGesturesOptions = {}) {
  const { camera } = useThree()

  // Store state
  const selectedObjectId = useVoxelStore((state) => state.selectedObjectId)
  const layout = useVoxelStore((state) => state.layout)
  const manipulation = useVoxelStore((state) => state.manipulation)
  const snapConfig = useVoxelStore((state) => state.snapConfig)
  const isEditorMode = useVoxelStore((state) => state.isEditorMode)

  // Store actions
  const selectObject = useVoxelStore((state) => state.selectObject)
  const setManipulationMode = useVoxelStore((state) => state.setManipulationMode)
  const setActiveHandle = useVoxelStore((state) => state.setActiveHandle)
  const setGhostPreview = useVoxelStore((state) => state.setGhostPreview)
  const startManipulation = useVoxelStore((state) => state.startManipulation)
  const endManipulation = useVoxelStore((state) => state.endManipulation)
  const moveObject = useVoxelStore((state) => state.moveObject)
  const resizeObject = useVoxelStore((state) => state.resizeObject)
  const rotateObject = useVoxelStore((state) => state.rotateObject)
  const pushHistory = useVoxelStore((state) => state.pushHistory)
  const setSnapGuides = useVoxelStore((state) => state.setSnapGuides)

  // Get the selected object
  const selectedObject = layout?.objects.find((obj) => obj.id === selectedObjectId) ?? null

  // Raycaster and ground plane for intersection calculations
  const { raycaster, groundPlane } = useMemo(() => ({
    raycaster: new Raycaster(),
    groundPlane: new Plane(new Vector3(0, 1, 0), 0),
  }), [])

  /**
   * Get world position from mouse coordinates
   */
  const getWorldPosition = useCallback(
    (clientX: number, clientY: number): VoxelPosition | null => {
      const canvas = document.querySelector('canvas')
      if (!canvas) return null

      const rect = canvas.getBoundingClientRect()
      const x = ((clientX - rect.left) / rect.width) * 2 - 1
      const y = -((clientY - rect.top) / rect.height) * 2 + 1

      raycaster.setFromCamera(new Vector2(x, y), camera)
      const intersection = new Vector3()
      const hit = raycaster.ray.intersectPlane(groundPlane, intersection)

      if (hit) {
        return {
          x: intersection.x,
          y: 0,
          z: intersection.z,
        }
      }
      return null
    },
    [camera, raycaster, groundPlane]
  )

  /**
   * Handle starting a manipulation operation
   */
  const handleHandlePointerDown = useCallback(
    (handleId: HandleId) => {
      if (!enabled || !isEditorMode || !selectedObject) return

      // Push current state to history before manipulation
      pushHistory()

      if (handleId === 'center') {
        setManipulationMode('move')
      } else if (handleId === 'rotate') {
        setManipulationMode('rotate')
      } else {
        setManipulationMode('resize')
      }

      setActiveHandle(handleId)
      startManipulation(selectedObject.position, {
        width: (selectedObject.metadata?.width as number) ?? 1,
        depth: (selectedObject.metadata?.depth as number) ?? 1,
      })
    },
    [enabled, isEditorMode, selectedObject, pushHistory, setManipulationMode, setActiveHandle, startManipulation]
  )

  /**
   * Handle completing a manipulation
   */
  const handleHandlePointerUp = useCallback(
    (_handleId?: HandleId) => {
      if (!enabled || manipulation.mode === 'none') return

      // Apply the ghost preview if exists
      if (manipulation.ghostPreview && selectedObjectId) {
        const preview = manipulation.ghostPreview
        if (manipulation.mode === 'resize') {
          resizeObject(selectedObjectId, {
            width: (preview.metadata?.width as number) ?? 1,
            depth: (preview.metadata?.depth as number) ?? 1,
          })
          // Also update position if it changed during resize
          moveObject(selectedObjectId, preview.position)
        } else if (manipulation.mode === 'move') {
          moveObject(selectedObjectId, preview.position)
        }
      }

      // Clear snap guides
      setSnapGuides([])
      endManipulation()
    },
    [enabled, manipulation, selectedObjectId, resizeObject, moveObject, setSnapGuides, endManipulation]
  )

  /**
   * Calculate new size based on handle drag
   */
  const calculateResizeFromHandle = useCallback(
    (handleId: HandleId, worldPos: VoxelPosition, startSize: { width: number; depth: number }, startPos: VoxelPosition): { width: number; depth: number; position: VoxelPosition } => {
      let newWidth = startSize.width
      let newDepth = startSize.depth
      let newX = startPos.x
      let newZ = startPos.z

      const deltaX = worldPos.x - (startPos.x + startSize.width / 2)
      const deltaZ = worldPos.z - (startPos.z + startSize.depth / 2)

      switch (handleId) {
        case 'e':
          newWidth = Math.max(1, startSize.width + deltaX)
          break
        case 'w':
          newWidth = Math.max(1, startSize.width - deltaX)
          newX = startPos.x + deltaX
          break
        case 's':
          newDepth = Math.max(1, startSize.depth + deltaZ)
          break
        case 'n':
          newDepth = Math.max(1, startSize.depth - deltaZ)
          newZ = startPos.z + deltaZ
          break
        case 'ne':
          newWidth = Math.max(1, startSize.width + deltaX)
          newDepth = Math.max(1, startSize.depth - deltaZ)
          newZ = startPos.z + deltaZ
          break
        case 'nw':
          newWidth = Math.max(1, startSize.width - deltaX)
          newX = startPos.x + deltaX
          newDepth = Math.max(1, startSize.depth - deltaZ)
          newZ = startPos.z + deltaZ
          break
        case 'se':
          newWidth = Math.max(1, startSize.width + deltaX)
          newDepth = Math.max(1, startSize.depth + deltaZ)
          break
        case 'sw':
          newWidth = Math.max(1, startSize.width - deltaX)
          newX = startPos.x + deltaX
          newDepth = Math.max(1, startSize.depth + deltaZ)
          break
      }

      return {
        width: newWidth,
        depth: newDepth,
        position: { x: newX, y: 0, z: newZ },
      }
    },
    []
  )

  /**
   * Handle world pointer move during manipulation (called from PointerCapturePlane)
   */
  const handleWorldPointerMove = useCallback(
    (worldPos: VoxelPosition) => {
      if (!enabled || !isEditorMode || manipulation.mode === 'none' || !selectedObject) return
      if (!manipulation.startPosition || !manipulation.startSize || !manipulation.activeHandle) return

      if (manipulation.mode === 'resize') {
        const result = calculateResizeFromHandle(
          manipulation.activeHandle,
          worldPos,
          manipulation.startSize,
          manipulation.startPosition
        )

        // Apply snap
        const otherObjects = layout?.objects.filter((obj) => obj.id !== selectedObjectId) ?? []
        const snapResult = calculateResizeSnap(
          result.position,
          { width: result.width, depth: result.depth },
          otherObjects,
          snapConfig,
          selectedObjectId ?? undefined
        )

        // Save snap guides to store
        setSnapGuides(snapResult.guides)

        // Create ghost preview
        const ghostPreview: VoxelObject = {
          ...selectedObject,
          position: result.position,
          metadata: {
            ...selectedObject.metadata,
            width: snapResult.size.width,
            depth: snapResult.size.depth,
          },
        }
        setGhostPreview(ghostPreview)
      } else if (manipulation.mode === 'move') {
        // Calculate new position based on mouse offset from object center
        const objectWidth = (selectedObject.metadata?.width as number) ?? 1
        const objectDepth = (selectedObject.metadata?.depth as number) ?? 1

        // Position the object so mouse is at the center
        const newPosition: VoxelPosition = {
          x: worldPos.x - objectWidth / 2,
          y: 0,
          z: worldPos.z - objectDepth / 2,
        }

        // Apply snap
        const otherObjects = layout?.objects.filter((obj) => obj.id !== selectedObjectId) ?? []
        const snapResult = calculateSnap(
          newPosition,
          { width: objectWidth, depth: objectDepth },
          otherObjects,
          snapConfig,
          selectedObjectId ?? undefined
        )

        // Save snap guides to store
        setSnapGuides(snapResult.guides)

        // Create ghost preview
        const ghostPreview: VoxelObject = {
          ...selectedObject,
          position: snapResult.position,
        }
        setGhostPreview(ghostPreview)
      } else if (manipulation.mode === 'rotate') {
        // For rotate, we just do 90 degree snaps
        rotateObject(selectedObjectId!)
        endManipulation()
      }
    },
    [
      enabled,
      isEditorMode,
      manipulation,
      selectedObject,
      selectedObjectId,
      layout,
      snapConfig,
      calculateResizeFromHandle,
      setGhostPreview,
      setSnapGuides,
      rotateObject,
      endManipulation,
    ]
  )

  /**
   * Handle keyboard shortcuts
   */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled || !isEditorMode) return

      // Ctrl+Z for undo (works without selection)
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        const undoAction = useVoxelStore.getState().undo
        undoAction()
        return
      }

      // Ctrl+Y or Ctrl+Shift+Z for redo (works without selection)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey) || (e.key === 'Z' && e.shiftKey))) {
        e.preventDefault()
        const redoAction = useVoxelStore.getState().redo
        redoAction()
        return
      }

      // Following shortcuts require selected object
      if (!selectedObjectId) return

      // R key for rotate
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        pushHistory()
        rotateObject(selectedObjectId)
      }

      // Delete/Backspace for delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        pushHistory()
        const removeObject = useVoxelStore.getState().removeObject
        removeObject(selectedObjectId)
        selectObject(null)
      }

      // Escape to deselect
      if (e.key === 'Escape') {
        e.preventDefault()
        if (manipulation.mode !== 'none') {
          setSnapGuides([])
          endManipulation()
        } else {
          selectObject(null)
        }
      }
    },
    [enabled, isEditorMode, selectedObjectId, manipulation, pushHistory, rotateObject, selectObject, setSnapGuides, endManipulation]
  )

  // Register keyboard event listener only (no window pointermove)
  useEffect(() => {
    if (!enabled || !isEditorMode) return

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [enabled, isEditorMode, handleKeyDown])

  return {
    selectedObject,
    manipulation,
    handleHandlePointerDown,
    handleHandlePointerUp,
    handleWorldPointerMove,
    getWorldPosition,
  }
}

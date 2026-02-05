import { useEffect, useCallback } from 'react'
import { useVoxelStore } from '../store/voxelStore'

/**
 * Hook for managing undo/redo keyboard shortcuts
 * Ctrl+Z for undo, Ctrl+Shift+Z for redo
 */
export function useHistory() {
  const undo = useVoxelStore((state) => state.undo)
  const redo = useVoxelStore((state) => state.redo)
  const canUndo = useVoxelStore((state) => state.canUndo)
  const canRedo = useVoxelStore((state) => state.canRedo)
  const isEditorMode = useVoxelStore((state) => state.isEditorMode)

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Only handle shortcuts in editor mode
      if (!isEditorMode) return

      // Check for Ctrl+Z (undo) and Ctrl+Shift+Z (redo)
      if (event.ctrlKey || event.metaKey) {
        if (event.key === 'z' || event.key === 'Z') {
          event.preventDefault()
          if (event.shiftKey) {
            // Redo
            if (canUndo) {
              redo()
            }
          } else {
            // Undo
            if (canUndo) {
              undo()
            }
          }
        }
        // Also support Ctrl+Y for redo (Windows convention)
        if (event.key === 'y' || event.key === 'Y') {
          event.preventDefault()
          if (canRedo) {
            redo()
          }
        }
      }
    },
    [undo, redo, canUndo, canRedo, isEditorMode]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])

  return {
    undo,
    redo,
    canUndo,
    canRedo,
  }
}

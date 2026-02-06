import { useEffect, useCallback, useRef } from 'react'
import { useVoxelStore } from '../store/voxelStore'

interface UseEditorHotkeysOptions {
  enabled?: boolean
  onToggleLibrary?: () => void
}

/**
 * Hook for RTS-style editor keyboard shortcuts.
 * Handles tool switching and overlay toggling outside the R3F context.
 * The manipulation-specific shortcuts (R, Del, Ctrl+Z/Y, Esc) are still
 * handled inside useManipulationGestures within the R3F canvas.
 */
export function useEditorHotkeys({ enabled = true, onToggleLibrary }: UseEditorHotkeysOptions = {}) {
  const isEditorMode = useVoxelStore((state) => state.isEditorMode)
  const setEditorTool = useVoxelStore((state) => state.setEditorTool)
  const toggleSnap = useVoxelStore((state) => state.toggleSnap)

  const onToggleLibraryRef = useRef(onToggleLibrary)
  onToggleLibraryRef.current = onToggleLibrary

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled || !isEditorMode) return

      // Don't intercept when typing in input fields
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return
      }

      // Don't intercept modified keys (Ctrl/Meta combos handled elsewhere)
      if (e.ctrlKey || e.metaKey || e.altKey) return

      switch (e.key.toLowerCase()) {
        case 'v':
          e.preventDefault()
          setEditorTool('select')
          break
        case 'f':
          e.preventDefault()
          setEditorTool('floor')
          break
        case 'b':
          e.preventDefault()
          onToggleLibraryRef.current?.()
          break
        case 'g':
          e.preventDefault()
          toggleSnap()
          break
        case 's':
          e.preventDefault()
          setEditorTool('stair')
          break
        case 'm':
          e.preventDefault()
          setEditorTool('move')
          break
      }
    },
    [enabled, isEditorMode, setEditorTool, toggleSnap]
  )

  useEffect(() => {
    if (!enabled || !isEditorMode) return

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, isEditorMode, handleKeyDown])
}

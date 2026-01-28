import { useEffect, useRef, useCallback } from 'react'
import { useVoxelStore, selectTables } from '../store/voxelStore'
import { useUpdateTablePosition } from './useLayoutsApi'
import type { VoxelTable } from '../types/voxel'

interface UseTablePositionSyncOptions {
  /** Whether sync is enabled (default: true) */
  enabled?: boolean
  /** Debounce delay in ms (default: 500) */
  debounceMs?: number
}

/**
 * Hook that syncs voxel table positions to the backend.
 * When a table is moved in editor mode, this hook automatically
 * saves the new position after a debounce delay.
 */
export function useTablePositionSync(options: UseTablePositionSyncOptions = {}) {
  const { enabled = true, debounceMs = 500 } = options
  const voxelTables = useVoxelStore(selectTables)
  const { mutate: updatePosition, isPending } = useUpdateTablePosition()

  // Track previous positions to detect changes
  const previousPositionsRef = useRef<Map<string, string>>(new Map())
  // Track debounce timers per table
  const debounceRef = useRef<Map<string, NodeJS.Timeout>>(new Map())

  // Generate a position key for comparison
  const getPositionKey = useCallback(
    (table: VoxelTable) =>
      `${table.position.x},${table.position.y},${table.position.z},${table.rotation.y}`,
    []
  )

  // Save position to backend
  const savePosition = useCallback(
    (table: VoxelTable) => {
      if (!table.linkedTableId) return

      updatePosition({
        tableId: table.linkedTableId,
        position: {
          x: table.position.x,
          y: table.position.y,
          z: table.position.z,
          rotation: table.rotation.y,
        },
      })

      // Update tracked position
      previousPositionsRef.current.set(table.id, getPositionKey(table))
    },
    [updatePosition, getPositionKey]
  )

  // Watch for position changes and debounce saves
  useEffect(() => {
    // Clear all pending timers when disabled
    if (!enabled) {
      debounceRef.current.forEach((timer) => clearTimeout(timer))
      debounceRef.current.clear()
      return
    }

    voxelTables.forEach((table) => {
      // Only sync tables that are linked to backend tables
      if (!table.linkedTableId) return

      const currentKey = getPositionKey(table)
      const previousKey = previousPositionsRef.current.get(table.id)

      // Skip if position hasn't changed
      if (previousKey === currentKey) return

      // Initialize previous position on first render
      if (previousKey === undefined) {
        previousPositionsRef.current.set(table.id, currentKey)
        return
      }

      // Clear existing debounce timer
      const existingTimer = debounceRef.current.get(table.id)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      // Set new debounce timer
      const timer = setTimeout(() => {
        savePosition(table)
        debounceRef.current.delete(table.id)
      }, debounceMs)

      debounceRef.current.set(table.id, timer)
    })

    // Cleanup timers on dependency changes
    return () => {
      debounceRef.current.forEach((timer) => clearTimeout(timer))
      debounceRef.current.clear()
    }
  }, [enabled, voxelTables, savePosition, getPositionKey, debounceMs])

  return {
    /** Whether a position update is currently being saved */
    isPending,
    /** Manually trigger a position save for a specific table */
    savePosition,
  }
}

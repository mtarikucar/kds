import { useCallback, useEffect, useRef } from 'react'
import { useVoxelStore, selectTables } from '../store/voxelStore'
import type { Table, TableStatus } from '@/types'
import type { VoxelTable, RestaurantLayout } from '../types/voxel'
import { DEFAULT_WORLD_DIMENSIONS } from '../types/voxel'

interface UseVoxelWorldOptions {
  tables: Table[]
  tenantId?: string
}

/**
 * Helper to check if a table has a saved voxel position
 */
const hasPosition = (table: Table): boolean => {
  return table.voxelX != null && table.voxelZ != null
}

/**
 * Get table dimensions based on capacity
 * Larger tables take more space
 */
const getTableDimensions = (capacity: number): { width: number; depth: number } => {
  if (capacity <= 2) return { width: 2, depth: 2 }
  if (capacity <= 4) return { width: 3, depth: 3 }
  if (capacity <= 6) return { width: 4, depth: 3 }
  if (capacity <= 8) return { width: 4, depth: 4 }
  // Large tables (10+ seats)
  return { width: 5, depth: 4 }
}

export function useVoxelWorld({ tables, tenantId }: UseVoxelWorldOptions) {
  const layout = useVoxelStore((state) => state.layout)
  const setLayout = useVoxelStore((state) => state.setLayout)
  const addObject = useVoxelStore((state) => state.addObject)
  const updateTableStatus = useVoxelStore((state) => state.updateTableStatus)
  const voxelTables = useVoxelStore(selectTables)

  // Track which table IDs have been added to voxel world to prevent re-adding
  const addedTableIdsRef = useRef<Set<string>>(new Set())

  // Initialize layout if not exists
  useEffect(() => {
    if (!layout && tenantId) {
      const initialLayout: RestaurantLayout = {
        id: `layout-${tenantId}`,
        tenantId,
        name: 'Main Floor',
        dimensions: DEFAULT_WORLD_DIMENSIONS,
        objects: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      setLayout(initialLayout)
    }
  }, [layout, tenantId, setLayout])

  // Load tables with saved positions into voxel world
  // Wait for layout to be initialized first
  useEffect(() => {
    if (!layout || tables.length === 0) return

    // Get current voxel tables from store for checking
    const currentVoxelTables = useVoxelStore.getState().layout?.objects || []

    tables.filter(hasPosition).forEach((table) => {
      // Skip if already added (check both ref and store)
      if (addedTableIdsRef.current.has(table.id)) return

      const existsInStore = currentVoxelTables.some(
        (obj) => obj.type === 'table' && (obj as VoxelTable).linkedTableId === table.id
      )
      if (existsInStore) {
        addedTableIdsRef.current.add(table.id)
        return
      }

      // Create new voxel table with saved position
      const dimensions = getTableDimensions(table.capacity)
      const voxelTable: VoxelTable = {
        id: `voxel-table-${table.id}`,
        type: 'table',
        position: {
          x: table.voxelX!,
          y: table.voxelY ?? 0,
          z: table.voxelZ!,
        },
        rotation: { y: table.voxelRotation ?? 0 },
        linkedTableId: table.id,
        status: table.status as TableStatus,
        tableNumber: table.number,
        capacity: table.capacity,
        metadata: { dimensions },
      }

      addedTableIdsRef.current.add(table.id)
      addObject(voxelTable)
    })
  }, [layout, tables, addObject])

  // Sync table statuses from backend tables
  useEffect(() => {
    tables.forEach((table) => {
      const voxelTable = voxelTables.find((vt) => vt.linkedTableId === table.id)
      if (voxelTable && voxelTable.status !== table.status) {
        updateTableStatus(table.id, table.status as TableStatus)
      }
    })
  }, [tables, voxelTables, updateTableStatus])

  // Add table to voxel world at a specific position
  const addTableToWorld = useCallback(
    (table: Table, position: { x: number; z: number }) => {
      const existingVoxelTable = voxelTables.find(
        (vt) => vt.linkedTableId === table.id
      )
      if (existingVoxelTable) {
        return // Already exists
      }

      const dimensions = getTableDimensions(table.capacity)
      const voxelTable: VoxelTable = {
        id: `voxel-table-${table.id}`,
        type: 'table',
        position: { x: position.x, y: 0, z: position.z },
        rotation: { y: 0 },
        linkedTableId: table.id,
        status: table.status as TableStatus,
        tableNumber: table.number,
        capacity: table.capacity,
        metadata: { dimensions },
      }

      addObject(voxelTable)
    },
    [voxelTables, addObject]
  )

  // Auto-place tables that don't have voxel positions
  const autoPlaceTables = useCallback(() => {
    const unplacedTables = tables.filter(
      (table) =>
        !hasPosition(table) &&
        !voxelTables.some((vt) => vt.linkedTableId === table.id)
    )

    const gridSize = Math.ceil(Math.sqrt(unplacedTables.length))
    const spacing = 5

    unplacedTables.forEach((table, index) => {
      const row = Math.floor(index / gridSize)
      const col = index % gridSize
      const x = 3 + col * spacing
      const z = 3 + row * spacing

      addTableToWorld(table, { x, z })
    })
  }, [tables, voxelTables, addTableToWorld])

  // Get unplaced tables (no saved position AND not in voxel world)
  const unplacedTables = tables.filter(
    (table) =>
      !hasPosition(table) &&
      !voxelTables.some((vt) => vt.linkedTableId === table.id)
  )

  return {
    layout,
    voxelTables,
    unplacedTables,
    addTableToWorld,
    autoPlaceTables,
  }
}

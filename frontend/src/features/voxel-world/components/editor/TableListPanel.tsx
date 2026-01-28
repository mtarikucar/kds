import { useState, useCallback } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Table2,
  Plus,
  CheckCircle,
  Clock,
  Users,
  Layers,
} from 'lucide-react'
import { useVoxelStore, selectTables } from '../../store/voxelStore'
import { DEFAULT_WORLD_DIMENSIONS, type VoxelTable } from '../../types/voxel'
import { suggestPosition } from '../../utils/placementEngine'
import type { Table, TableStatus } from '@/types'
import { cn } from '@/lib/utils'

interface TableListPanelProps {
  tables: Table[]
}

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: 'bg-green-500',
  OCCUPIED: 'bg-red-500',
  RESERVED: 'bg-amber-500',
}

const STATUS_ICONS: Record<string, string> = {
  AVAILABLE: '🟢',
  OCCUPIED: '🔴',
  RESERVED: '🟡',
}

/**
 * Get table dimensions based on capacity
 */
const getTableDimensions = (capacity: number): { width: number; height: number; depth: number } => {
  if (capacity <= 2) return { width: 2, height: 1, depth: 2 }
  if (capacity <= 4) return { width: 3, height: 1, depth: 3 }
  if (capacity <= 6) return { width: 4, height: 1, depth: 3 }
  if (capacity <= 8) return { width: 4, height: 1, depth: 4 }
  return { width: 5, height: 1, depth: 4 }
}

export function TableListPanel({ tables }: TableListPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  const layout = useVoxelStore((state) => state.layout)
  const addObject = useVoxelStore((state) => state.addObject)
  const selectObject = useVoxelStore((state) => state.selectObject)
  const voxelTables = useVoxelStore(selectTables)

  // Check if a table is placed in voxel world
  const isPlaced = useCallback(
    (tableId: string): boolean => {
      return voxelTables.some((vt) => vt.linkedTableId === tableId)
    },
    [voxelTables]
  )

  // Get voxel table by linked table id
  const getVoxelTable = useCallback(
    (tableId: string): VoxelTable | undefined => {
      return voxelTables.find((vt) => vt.linkedTableId === tableId)
    },
    [voxelTables]
  )

  // Add table to voxel world
  const handleAddTable = useCallback(
    (table: Table) => {
      if (!layout) return
      if (isPlaced(table.id)) return

      const dimensions = getTableDimensions(table.capacity)
      const worldDims = layout.dimensions ?? DEFAULT_WORLD_DIMENSIONS

      const position = suggestPosition(
        'table',
        dimensions,
        layout.objects,
        worldDims
      ) ?? { x: 5, y: 0, z: 5 }

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
      selectObject(voxelTable.id)
    },
    [layout, addObject, selectObject, isPlaced]
  )

  // Select table in 3D view
  const handleSelectTable = useCallback(
    (table: Table) => {
      const voxelTable = getVoxelTable(table.id)
      if (voxelTable) {
        selectObject(voxelTable.id)
      }
    },
    [getVoxelTable, selectObject]
  )

  // Add all unplaced tables
  const handleAddAllTables = useCallback(() => {
    if (!layout) return

    const unplacedTables = tables.filter((t) => !isPlaced(t.id))
    const gridSize = Math.ceil(Math.sqrt(unplacedTables.length))
    const spacing = 5

    unplacedTables.forEach((table, index) => {
      const row = Math.floor(index / gridSize)
      const col = index % gridSize
      const x = 3 + col * spacing
      const z = 3 + row * spacing
      const dimensions = getTableDimensions(table.capacity)

      const voxelTable: VoxelTable = {
        id: `voxel-table-${table.id}`,
        type: 'table',
        position: { x, y: 0, z },
        rotation: { y: 0 },
        linkedTableId: table.id,
        status: table.status as TableStatus,
        tableNumber: table.number,
        capacity: table.capacity,
        metadata: { dimensions },
      }

      addObject(voxelTable)
    })
  }, [layout, tables, isPlaced, addObject])

  const placedCount = tables.filter((t) => isPlaced(t.id)).length
  const unplacedCount = tables.length - placedCount

  return (
    <div className="rounded-lg bg-gray-800">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-white"
      >
        <span className="flex items-center gap-2">
          <Table2 className="h-4 w-4" />
          Masalar ({tables.length})
        </span>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {isExpanded && (
        <div className="p-2 pt-0">
          {/* Summary badges */}
          <div className="mb-2 flex gap-2 text-xs">
            <span className="flex items-center gap-1 rounded bg-green-900/50 px-2 py-0.5 text-green-400">
              <CheckCircle className="h-3 w-3" />
              {placedCount} yerlesik
            </span>
            {unplacedCount > 0 && (
              <span className="flex items-center gap-1 rounded bg-amber-900/50 px-2 py-0.5 text-amber-400">
                <Clock className="h-3 w-3" />
                {unplacedCount} bekliyor
              </span>
            )}
          </div>

          {/* Table list */}
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {tables.map((table) => {
              const placed = isPlaced(table.id)
              const voxelTable = getVoxelTable(table.id)

              return (
                <div
                  key={table.id}
                  className={cn(
                    'flex items-center justify-between rounded px-2 py-1.5 text-xs transition-colors',
                    placed
                      ? 'cursor-pointer bg-gray-700/50 hover:bg-gray-700'
                      : 'bg-gray-700/30'
                  )}
                  onClick={() => placed && handleSelectTable(table)}
                >
                  <div className="flex items-center gap-2">
                    {/* Status indicator */}
                    <div
                      className={cn(
                        'h-2 w-2 rounded-full',
                        STATUS_COLORS[table.status] || 'bg-gray-500'
                      )}
                      title={table.status}
                    />

                    {/* Table info */}
                    <div>
                      <span className="font-medium text-white">
                        {table.number}
                      </span>
                      <span className="ml-2 flex items-center gap-0.5 text-gray-400">
                        <Users className="h-3 w-3" />
                        {table.capacity}
                      </span>
                    </div>
                  </div>

                  {/* Right side: badge or add button */}
                  {placed ? (
                    <span className="rounded bg-green-900/50 px-1.5 py-0.5 text-[10px] text-green-400">
                      ✓ Yerlesik
                    </span>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleAddTable(table)
                      }}
                      className="flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-primary transition-colors hover:bg-primary/30"
                      title="Masayı yerleştir"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )
            })}

            {tables.length === 0 && (
              <div className="py-4 text-center text-xs text-gray-500">
                Henuz masa yok
              </div>
            )}
          </div>

          {/* Add all button */}
          {unplacedCount > 0 && (
            <button
              onClick={handleAddAllTables}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
            >
              <Layers className="h-3.5 w-3.5" />
              Tumunu Yerlestir ({unplacedCount})
            </button>
          )}
        </div>
      )}
    </div>
  )
}

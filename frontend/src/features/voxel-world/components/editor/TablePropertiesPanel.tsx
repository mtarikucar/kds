import { useState, useCallback } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Settings2,
  Users,
  MapPin,
  RotateCw,
  Trash2,
} from 'lucide-react'
import { useVoxelStore, selectSelectedObject } from '../../store/voxelStore'
import type { VoxelTable } from '../../types/voxel'
import { TableStatus } from '@/types'
import { cn } from '@/lib/utils'

const STATUS_OPTIONS: { value: TableStatus; label: string; color: string }[] = [
  { value: TableStatus.AVAILABLE, label: 'Musait', color: 'bg-green-500' },
  { value: TableStatus.OCCUPIED, label: 'Dolu', color: 'bg-red-500' },
  { value: TableStatus.RESERVED, label: 'Rezerve', color: 'bg-amber-500' },
]

const ROTATION_OPTIONS = [
  { value: 0, label: '0°' },
  { value: 90, label: '90°' },
  { value: 180, label: '180°' },
  { value: 270, label: '270°' },
]

export function TablePropertiesPanel() {
  const [isExpanded, setIsExpanded] = useState(true)

  const selectedObject = useVoxelStore(selectSelectedObject)
  const moveObject = useVoxelStore((state) => state.moveObject)
  const setObjectRotation = useVoxelStore((state) => state.setObjectRotation)
  const updateTableStatus = useVoxelStore((state) => state.updateTableStatus)
  const removeTableFromLayout = useVoxelStore((state) => state.removeTableFromLayout)
  const selectObject = useVoxelStore((state) => state.selectObject)

  // Only show if selected object is a table
  if (!selectedObject || selectedObject.type !== 'table') {
    return null
  }

  const table = selectedObject as VoxelTable

  const handlePositionChange = useCallback(
    (axis: 'x' | 'z', value: number) => {
      const newPosition = {
        ...table.position,
        [axis]: Math.max(0, Math.min(31, value)),
      }
      moveObject(table.id, newPosition)
    },
    [table.id, table.position, moveObject]
  )

  const handleRotationChange = useCallback(
    (rotation: number) => {
      setObjectRotation(table.id, rotation)
    },
    [table.id, setObjectRotation]
  )

  const handleStatusChange = useCallback(
    (status: TableStatus) => {
      if (table.linkedTableId) {
        updateTableStatus(table.linkedTableId, status)
      }
    },
    [table.linkedTableId, updateTableStatus]
  )

  const handleRemoveFromLayout = useCallback(() => {
    if (table.linkedTableId) {
      removeTableFromLayout(table.linkedTableId)
      selectObject(null)
    }
  }, [table.linkedTableId, removeTableFromLayout, selectObject])

  return (
    <div className="rounded-lg bg-gray-800">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-white"
      >
        <span className="flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          Secili Masa: {table.tableNumber}
        </span>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {isExpanded && (
        <div className="space-y-3 p-3 pt-0">
          {/* Capacity display */}
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Users className="h-3.5 w-3.5" />
            <span>Kapasite: {table.capacity} kisi</span>
          </div>

          {/* Position controls */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <MapPin className="h-3.5 w-3.5" />
              <span>Pozisyon</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[10px] text-gray-500">X</label>
                <input
                  type="number"
                  min={0}
                  max={31}
                  value={Math.round(table.position.x)}
                  onChange={(e) => handlePositionChange('x', parseInt(e.target.value) || 0)}
                  className="w-full rounded bg-gray-700 px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] text-gray-500">Z</label>
                <input
                  type="number"
                  min={0}
                  max={31}
                  value={Math.round(table.position.z)}
                  onChange={(e) => handlePositionChange('z', parseInt(e.target.value) || 0)}
                  className="w-full rounded bg-gray-700 px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
          </div>

          {/* Rotation controls */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <RotateCw className="h-3.5 w-3.5" />
              <span>Rotasyon</span>
            </div>
            <div className="flex gap-1">
              {ROTATION_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleRotationChange(option.value)}
                  className={cn(
                    'flex-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                    table.rotation.y === option.value
                      ? 'bg-primary text-white'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-white'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Status controls */}
          <div className="space-y-2">
            <div className="text-xs text-gray-400">Durum</div>
            <div className="flex gap-1">
              {STATUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleStatusChange(option.value)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                    table.status === option.value
                      ? 'bg-gray-600 text-white'
                      : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                  )}
                >
                  <div className={cn('h-2 w-2 rounded-full', option.color)} />
                  <span className="hidden sm:inline">{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Remove button */}
          <button
            onClick={handleRemoveFromLayout}
            className="flex w-full items-center justify-center gap-2 rounded bg-red-900/30 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-900/50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Layouttan Kaldir
          </button>

          <p className="text-[10px] text-gray-500">
            * Masayi layouttan kaldirmak veritabanindan silmez
          </p>
        </div>
      )}
    </div>
  )
}

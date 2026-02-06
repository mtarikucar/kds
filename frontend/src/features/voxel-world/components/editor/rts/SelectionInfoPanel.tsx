import { useCallback } from 'react'
import {
  RotateCw,
  Trash2,
  Users,
  MapPin,
  X,
} from 'lucide-react'
import { useVoxelStore, selectSelectedObject } from '../../../store/voxelStore'
import type { VoxelTable } from '../../../types/voxel'
import { cn } from '@/lib/utils'

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-500',
  occupied: 'bg-red-500',
  reserved: 'bg-amber-500',
}

export function SelectionInfoPanel() {
  const selectedObject = useVoxelStore(selectSelectedObject)
  const rotateObject = useVoxelStore((state) => state.rotateObject)
  const removeObject = useVoxelStore((state) => state.removeObject)
  const selectObject = useVoxelStore((state) => state.selectObject)

  const table = selectedObject?.type === 'table' ? (selectedObject as VoxelTable) : null

  const handleRotate = useCallback(() => {
    if (selectedObject) {
      rotateObject(selectedObject.id)
    }
  }, [selectedObject, rotateObject])

  const handleDelete = useCallback(() => {
    if (selectedObject) {
      removeObject(selectedObject.id)
    }
  }, [selectedObject, removeObject])

  const handleDeselect = useCallback(() => {
    selectObject(null)
  }, [selectObject])

  if (!selectedObject) return null

  return (
    <div className="absolute left-4 top-16 z-30 w-56 rounded-xl bg-white/95 shadow-xl backdrop-blur-md border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <div className="flex items-center gap-2">
          {table && (
            <div className={cn('h-2.5 w-2.5 rounded-full', STATUS_COLORS[table.status] ?? 'bg-slate-400')} />
          )}
          <span className="text-sm font-semibold text-slate-900">
            {table ? table.tableNumber : selectedObject.type}
          </span>
        </div>
        <button
          onClick={handleDeselect}
          className="rounded p-0.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Info */}
      <div className="space-y-1.5 px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <MapPin className="h-3 w-3" />
          <span>
            Position: ({Math.round(selectedObject.position.x)}, {Math.round(selectedObject.position.z)})
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <RotateCw className="h-3 w-3" />
          <span>Rotation: {selectedObject.rotation.y}°</span>
        </div>
        {table && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Users className="h-3 w-3" />
            <span>Capacity: {table.capacity}</span>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="flex border-t border-slate-100">
        <button
          onClick={handleRotate}
          className="flex flex-1 items-center justify-center gap-1.5 py-2 text-xs text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
          title="Rotate 90° (R)"
        >
          <RotateCw className="h-3.5 w-3.5" />
          Rotate
        </button>
        <div className="w-px bg-slate-100" />
        <button
          onClick={handleDelete}
          className="flex flex-1 items-center justify-center gap-1.5 py-2 text-xs text-red-500 transition-colors hover:bg-red-50 hover:text-red-600"
          title="Delete (Del)"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>
    </div>
  )
}

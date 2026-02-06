import { Save, Grid3X3, Box, HelpCircle } from 'lucide-react'
import type { VoxelObject, VoxelTable } from '../../../types/voxel'

interface StatusBarProps {
  isSaving?: boolean
  objectCount: number
  snapEnabled: boolean
  selectedObject?: VoxelObject | null
}

export function StatusBar({
  isSaving = false,
  objectCount,
  snapEnabled,
  selectedObject,
}: StatusBarProps) {
  const table = selectedObject?.type === 'table' ? (selectedObject as VoxelTable) : null

  return (
    <div className="mt-1 flex items-center justify-between rounded-lg bg-white/90 px-3 py-1 text-[10px] text-slate-500 backdrop-blur-sm border border-slate-200">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">
          <Grid3X3 className="h-3 w-3" />
          Grid: {snapEnabled ? 'ON' : 'OFF'}
        </span>
        <span className="flex items-center gap-1">
          <Box className="h-3 w-3" />
          {objectCount} Objects
        </span>
        {selectedObject && (
          <span className="text-primary font-medium">
            Selected: {table?.tableNumber ?? selectedObject.type} ({Math.round(selectedObject.position.x)}, {Math.round(selectedObject.position.z)})
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        {isSaving && (
          <span className="flex items-center gap-1 text-amber-600">
            <Save className="h-3 w-3 animate-pulse" />
            Saving...
          </span>
        )}
        <span className="flex items-center gap-1">
          <HelpCircle className="h-3 w-3" />
          R: Rotate | Del: Delete | G: Grid | B: Library
        </span>
      </div>
    </div>
  )
}

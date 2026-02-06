import { useEffect, useCallback, useRef } from 'react'
import {
  Armchair,
  ChefHat,
  Coffee,
  TreePine,
  Square,
  Box,
  Sofa,
  Flower,
  X,
} from 'lucide-react'
import { useObjectPlacement } from '../../../hooks/useObjectPlacement'
import { FURNITURE_LIBRARY, type LibraryItem } from '../../../types/voxel'

interface RTSObjectLibraryProps {
  onClose: () => void
}

const ICON_MAP: Record<string, typeof Armchair> = {
  armchair: Armchair,
  'chef-hat': ChefHat,
  coffee: Coffee,
  'tree-pine': TreePine,
  square: Square,
  box: Box,
  sofa: Sofa,
  flower: Flower,
}

// Filter out table items — tables must come from the database, not the library
const NON_TABLE_LIBRARY = FURNITURE_LIBRARY.filter((item) => item.type !== 'table')

export function RTSObjectLibrary({ onClose }: RTSObjectLibraryProps) {
  const panelRef = useRef<HTMLDivElement>(null)

  const { placeLibraryItem } = useObjectPlacement()

  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    },
    [onClose]
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose]
  )

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleClickOutside, handleKeyDown])

  const handleItemClick = useCallback(
    (item: LibraryItem) => {
      placeLibraryItem(item)
    },
    [placeLibraryItem]
  )

  return (
    <div
      ref={panelRef}
      className="absolute bottom-20 left-1/2 z-40 -translate-x-1/2 w-[560px] max-h-80 rounded-xl bg-white/95 shadow-xl backdrop-blur-md border border-slate-200 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <div className="flex items-center gap-2">
          <Box className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-slate-900">Object Library</h3>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="overflow-y-auto max-h-64 p-3">
        <div className="grid grid-cols-4 gap-2">
          {NON_TABLE_LIBRARY.map((item) => {
            const Icon = ICON_MAP[item.icon] || Square
            return (
              <button
                key={item.id}
                onClick={() => handleItemClick(item)}
                className="flex flex-col items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50 p-3 text-xs transition-all hover:border-primary/30 hover:bg-primary/5 hover:shadow-sm active:scale-95"
                title={item.description}
              >
                <Icon className="h-6 w-6 text-slate-600" />
                <span className="text-center text-[11px] text-slate-600">{item.name}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

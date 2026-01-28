import { useTranslation } from 'react-i18next'
import {
  ZoomIn,
  ZoomOut,
  Grid3X3,
  Magnet,
  RotateCcw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Map2DConfig, Map2DViewState } from '../../types/map2d'
import { DEFAULT_MAP2D_VIEW_STATE } from '../../types/map2d'

interface Map2DToolbarProps {
  config: Map2DConfig
  viewState: Map2DViewState
  onConfigChange: (config: Partial<Map2DConfig>) => void
  onViewStateChange: (viewState: Map2DViewState) => void
}

export function Map2DToolbar({
  config,
  viewState,
  onConfigChange,
  onViewStateChange,
}: Map2DToolbarProps) {
  const { t } = useTranslation()

  const handleZoomIn = () => {
    const newScale = Math.min(viewState.scale * 1.2, 50)
    onViewStateChange({
      ...viewState,
      scale: newScale,
    })
  }

  const handleZoomOut = () => {
    const newScale = Math.max(viewState.scale / 1.2, 5)
    onViewStateChange({
      ...viewState,
      scale: newScale,
    })
  }

  const handleResetView = () => {
    onViewStateChange(DEFAULT_MAP2D_VIEW_STATE)
  }

  const handleToggleGrid = () => {
    onConfigChange({ showGrid: !config.showGrid })
  }

  const handleToggleSnap = () => {
    onConfigChange({ snapToGrid: !config.snapToGrid })
  }

  const zoomPercent = Math.round((viewState.scale / DEFAULT_MAP2D_VIEW_STATE.scale) * 100)

  return (
    <div className="flex items-center gap-1.5 rounded-xl bg-slate-800/90 backdrop-blur-sm p-1.5 shadow-lg border border-slate-700/50">
      {/* Zoom controls */}
      <div className="flex items-center gap-0.5 rounded-lg bg-slate-700/50 p-0.5">
        <button
          onClick={handleZoomOut}
          className="rounded-md p-2 text-slate-400 transition-all duration-200 hover:bg-slate-600/80 hover:text-white hover:scale-105 active:scale-95"
          title={t('voxel.map2d.zoomOut', 'Zoom Out')}
          aria-label={t('voxel.map2d.zoomOut', 'Zoom Out')}
        >
          <ZoomOut className="h-4 w-4" aria-hidden="true" />
        </button>

        <span className="min-w-[50px] text-center text-xs font-medium text-slate-300 tabular-nums" aria-live="polite">
          {zoomPercent}%
        </span>

        <button
          onClick={handleZoomIn}
          className="rounded-md p-2 text-slate-400 transition-all duration-200 hover:bg-slate-600/80 hover:text-white hover:scale-105 active:scale-95"
          title={t('voxel.map2d.zoomIn', 'Zoom In')}
          aria-label={t('voxel.map2d.zoomIn', 'Zoom In')}
        >
          <ZoomIn className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="h-6 w-px bg-slate-600/50" aria-hidden="true" />

      {/* Toggle controls */}
      <div className="flex items-center gap-0.5 rounded-lg bg-slate-700/50 p-0.5">
        {/* Grid toggle */}
        <button
          onClick={handleToggleGrid}
          className={cn(
            'rounded-md p-2 transition-all duration-200 hover:scale-105 active:scale-95',
            config.showGrid
              ? 'bg-primary text-white shadow-md shadow-primary/25'
              : 'text-slate-400 hover:bg-slate-600/80 hover:text-white'
          )}
          title={t('voxel.map2d.toggleGrid', 'Toggle Grid')}
          aria-label={t('voxel.map2d.toggleGrid', 'Toggle Grid')}
          aria-pressed={config.showGrid}
        >
          <Grid3X3 className="h-4 w-4" aria-hidden="true" />
        </button>

        {/* Snap toggle */}
        <button
          onClick={handleToggleSnap}
          className={cn(
            'rounded-md p-2 transition-all duration-200 hover:scale-105 active:scale-95',
            config.snapToGrid
              ? 'bg-primary text-white shadow-md shadow-primary/25'
              : 'text-slate-400 hover:bg-slate-600/80 hover:text-white'
          )}
          title={t('voxel.map2d.toggleSnap', 'Snap to Grid')}
          aria-label={t('voxel.map2d.toggleSnap', 'Snap to Grid')}
          aria-pressed={config.snapToGrid}
        >
          <Magnet className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="h-6 w-px bg-slate-600/50" aria-hidden="true" />

      {/* Reset view */}
      <button
        onClick={handleResetView}
        className="rounded-md p-2 text-slate-400 transition-all duration-200 hover:bg-slate-600/80 hover:text-white hover:scale-105 active:scale-95"
        title={t('voxel.map2d.resetView', 'Reset View')}
        aria-label={t('voxel.map2d.resetView', 'Reset View')}
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}

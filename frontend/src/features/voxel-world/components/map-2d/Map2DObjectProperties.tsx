import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCw, X, Move } from 'lucide-react'
import type { Map2DObject } from '../../types/map2d'
import { cn } from '@/lib/utils'

interface Map2DObjectPropertiesProps {
  object: Map2DObject
  worldBounds: { width: number; height: number }
  onPositionChange: (x: number, z: number) => void
  onRotationChange: (rotation: number) => void
  onClose: () => void
}

export function Map2DObjectProperties({
  object,
  worldBounds,
  onPositionChange,
  onRotationChange,
  onClose,
}: Map2DObjectPropertiesProps) {
  const { t } = useTranslation()
  const [localX, setLocalX] = useState(String(object.x))
  const [localZ, setLocalZ] = useState(String(object.z))

  // Sync local state with object position
  useEffect(() => {
    setLocalX(String(object.x))
    setLocalZ(String(object.z))
  }, [object.x, object.z])

  const handleXChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalX(e.target.value)
  }

  const handleZChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalZ(e.target.value)
  }

  const handleXBlur = () => {
    const x = parseFloat(localX)
    if (!isNaN(x)) {
      const clampedX = Math.max(0, Math.min(worldBounds.width - object.width, x))
      onPositionChange(clampedX, object.z)
      setLocalX(String(clampedX))
    } else {
      setLocalX(String(object.x))
    }
  }

  const handleZBlur = () => {
    const z = parseFloat(localZ)
    if (!isNaN(z)) {
      const clampedZ = Math.max(0, Math.min(worldBounds.height - object.depth, z))
      onPositionChange(object.x, clampedZ)
      setLocalZ(String(clampedZ))
    } else {
      setLocalZ(String(object.z))
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur()
    }
  }

  const handleRotate = () => {
    const newRotation = (object.rotation + 90) % 360
    onRotationChange(newRotation)
  }

  const rotationLabels: Record<number, string> = {
    0: '0°',
    90: '90°',
    180: '180°',
    270: '270°',
  }

  return (
    <div className="rounded-xl bg-slate-800/95 backdrop-blur-sm p-4 shadow-xl border border-slate-700/50 animate-in slide-in-from-bottom-2 fade-in duration-200">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <Move className="h-4 w-4 text-primary" />
          {t('voxel.map2d.properties', 'Properties')}
        </h3>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700/80 hover:text-white transition-all duration-200 hover:scale-105 active:scale-95"
          aria-label={t('app.close', 'Close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Object info card */}
      <div className="mb-4 rounded-lg bg-slate-700/40 p-3 border border-slate-600/30">
        <div className="flex items-center gap-3">
          <div
            className="h-8 w-8 rounded-lg shadow-inner flex items-center justify-center"
            style={{ backgroundColor: object.color }}
          >
            {object.label && (
              <span className="text-xs font-bold text-white shadow-sm">
                {object.label.length > 2 ? object.label.slice(0, 2) : object.label}
              </span>
            )}
          </div>
          <div>
            <span className="text-sm font-medium capitalize text-white">
              {object.type}
            </span>
            {object.label && (
              <span className="text-xs text-slate-400 ml-2">
                #{object.label}
              </span>
            )}
            <div className="text-xs text-slate-500 mt-0.5">
              {object.width} × {object.depth} {t('voxel.map2d.units', 'units')}
            </div>
          </div>
        </div>
      </div>

      {/* Position inputs */}
      <div className="mb-4">
        <label className="mb-2 block text-xs font-medium text-slate-400 uppercase tracking-wide">
          Position
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs text-slate-500">X</label>
            <input
              type="number"
              value={localX}
              onChange={handleXChange}
              onBlur={handleXBlur}
              onKeyDown={handleKeyDown}
              min={0}
              max={worldBounds.width - object.width}
              step={1}
              className="w-full rounded-lg bg-slate-700/60 border border-slate-600/50 px-3 py-2 text-sm text-white
                         placeholder-slate-500 transition-all duration-200
                         focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50
                         hover:bg-slate-700/80"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-slate-500">Z</label>
            <input
              type="number"
              value={localZ}
              onChange={handleZChange}
              onBlur={handleZBlur}
              onKeyDown={handleKeyDown}
              min={0}
              max={worldBounds.height - object.depth}
              step={1}
              className="w-full rounded-lg bg-slate-700/60 border border-slate-600/50 px-3 py-2 text-sm text-white
                         placeholder-slate-500 transition-all duration-200
                         focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50
                         hover:bg-slate-700/80"
            />
          </div>
        </div>
      </div>

      {/* Rotation control */}
      <div>
        <label className="mb-2 block text-xs font-medium text-slate-400 uppercase tracking-wide">
          {t('voxel.map2d.rotation', 'Rotation')}
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRotate}
            className="flex items-center gap-2 rounded-lg bg-slate-700/60 border border-slate-600/50 px-4 py-2 text-sm text-white
                       transition-all duration-200 hover:bg-slate-600/80 hover:scale-105 active:scale-95"
          >
            <RotateCw className="h-4 w-4 text-primary" />
            <span className="font-medium">{rotationLabels[object.rotation] ?? `${object.rotation}°`}</span>
          </button>
          <div className="flex gap-1 flex-1">
            {[0, 90, 180, 270].map((rot) => (
              <button
                key={rot}
                onClick={() => onRotationChange(rot)}
                className={cn(
                  'flex-1 rounded-lg px-2 py-2 text-xs font-medium transition-all duration-200 hover:scale-105 active:scale-95',
                  object.rotation === rot
                    ? 'bg-primary text-white shadow-md shadow-primary/25'
                    : 'bg-slate-700/40 border border-slate-600/30 text-slate-400 hover:bg-slate-600/60 hover:text-white'
                )}
              >
                {rot}°
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

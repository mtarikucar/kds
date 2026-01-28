import { useState, useCallback } from 'react'
import { Maximize2, Link, Unlink, ChevronDown, ChevronUp } from 'lucide-react'
import { useVoxelStore } from '../../store/voxelStore'
import { cn } from '@/lib/utils'

interface Preset {
  name: string
  width: number
  depth: number
}

const PRESETS: Preset[] = [
  { name: 'Kucuk', width: 20, depth: 20 },
  { name: 'Orta', width: 32, depth: 32 },
  { name: 'Buyuk', width: 48, depth: 48 },
  { name: 'Genis', width: 48, depth: 32 },
]

const MIN_SIZE = 16
const MAX_SIZE = 64

export function DimensionsEditor() {
  const layout = useVoxelStore((state) => state.layout)
  const setLayoutDimensions = useVoxelStore((state) => state.setLayoutDimensions)

  const currentWidth = layout?.dimensions.width ?? 32
  const currentDepth = layout?.dimensions.depth ?? 32

  const [isExpanded, setIsExpanded] = useState(false)
  const [isLinked, setIsLinked] = useState(currentWidth === currentDepth)

  const handleWidthChange = useCallback(
    (value: number) => {
      const clampedValue = Math.max(MIN_SIZE, Math.min(MAX_SIZE, value))
      if (isLinked) {
        setLayoutDimensions(clampedValue, clampedValue)
      } else {
        setLayoutDimensions(clampedValue, currentDepth)
      }
    },
    [isLinked, currentDepth, setLayoutDimensions]
  )

  const handleDepthChange = useCallback(
    (value: number) => {
      const clampedValue = Math.max(MIN_SIZE, Math.min(MAX_SIZE, value))
      if (isLinked) {
        setLayoutDimensions(clampedValue, clampedValue)
      } else {
        setLayoutDimensions(currentWidth, clampedValue)
      }
    },
    [isLinked, currentWidth, setLayoutDimensions]
  )

  const handlePresetClick = useCallback(
    (preset: Preset) => {
      setLayoutDimensions(preset.width, preset.depth)
      setIsLinked(preset.width === preset.depth)
    },
    [setLayoutDimensions]
  )

  const handleToggleLink = useCallback(() => {
    if (!isLinked) {
      // When linking, sync depth to width
      setLayoutDimensions(currentWidth, currentWidth)
    }
    setIsLinked((prev) => !prev)
  }, [isLinked, currentWidth, setLayoutDimensions])

  return (
    <div className="rounded-lg bg-gray-800">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-white"
      >
        <span className="flex items-center gap-2">
          <Maximize2 className="h-4 w-4" />
          <span>Boyutlar</span>
          <span className="text-xs text-gray-400">
            ({currentWidth}x{currentDepth})
          </span>
        </span>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="flex flex-col gap-3 px-3 pb-3">
          {/* Width slider */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-400">Genislik</label>
              <span className="text-xs font-medium text-gray-300">{currentWidth}</span>
            </div>
            <input
              type="range"
              min={MIN_SIZE}
              max={MAX_SIZE}
              value={currentWidth}
              onChange={(e) => handleWidthChange(Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-700 accent-primary"
            />
          </div>

          {/* Link toggle */}
          <button
            onClick={handleToggleLink}
            className={cn(
              'flex items-center justify-center gap-1.5 rounded py-1.5 text-xs transition-colors',
              isLinked
                ? 'bg-primary/20 text-primary'
                : 'bg-gray-700 text-gray-400 hover:text-gray-300'
            )}
            title={isLinked ? 'Bagimsiz boyutlar' : 'Kare yap (genislik = derinlik)'}
          >
            {isLinked ? (
              <>
                <Link className="h-3 w-3" />
                <span>Kare (Senkron)</span>
              </>
            ) : (
              <>
                <Unlink className="h-3 w-3" />
                <span>Bagimsiz</span>
              </>
            )}
          </button>

          {/* Depth slider */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-400">Derinlik</label>
              <span className="text-xs font-medium text-gray-300">{currentDepth}</span>
            </div>
            <input
              type="range"
              min={MIN_SIZE}
              max={MAX_SIZE}
              value={currentDepth}
              onChange={(e) => handleDepthChange(Number(e.target.value))}
              disabled={isLinked}
              className={cn(
                'h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-700 accent-primary',
                isLinked && 'cursor-not-allowed opacity-50'
              )}
            />
          </div>

          {/* Presets */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-gray-400">Hazir Boyutlar</span>
            <div className="grid grid-cols-2 gap-1">
              {PRESETS.map((preset) => {
                const isActive =
                  currentWidth === preset.width && currentDepth === preset.depth
                return (
                  <button
                    key={preset.name}
                    onClick={() => handlePresetClick(preset)}
                    className={cn(
                      'flex flex-col items-center rounded px-2 py-1.5 text-xs transition-colors',
                      isActive
                        ? 'bg-primary text-white'
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-300'
                    )}
                  >
                    <span className="font-medium">{preset.name}</span>
                    <span className="text-[10px] opacity-70">
                      {preset.width}x{preset.depth}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

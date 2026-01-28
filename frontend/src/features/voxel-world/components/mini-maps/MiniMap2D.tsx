import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Map, ExternalLink } from 'lucide-react'
import type { Map2DObject, Map2DConfig } from '../../types/map2d'
import { cn } from '@/lib/utils'
import { LAYER_ORDER, MAP2D_COLORS_PRO } from '../map-2d/renderers'

// Design tokens
const MINIMAP_COLORS = {
  background: 'rgba(15, 23, 42, 0.95)',
  border: 'rgba(100, 116, 139, 0.5)',
  floor: '#1E293B',
  gridLine: 'rgba(71, 85, 105, 0.3)',
  // Object-specific colors from professional palette
  wall: MAP2D_COLORS_PRO.wall,
  door: MAP2D_COLORS_PRO.door,
  window: MAP2D_COLORS_PRO.window,
  kitchen: MAP2D_COLORS_PRO.kitchen,
  bar: MAP2D_COLORS_PRO.bar,
  chair: MAP2D_COLORS_PRO.chair,
  decor: MAP2D_COLORS_PRO.plant,
  model: MAP2D_COLORS_PRO.model,
  table: {
    available: MAP2D_COLORS_PRO.available,
    occupied: MAP2D_COLORS_PRO.occupied,
    reserved: MAP2D_COLORS_PRO.reserved,
    selected: '#3B82F6',
  },
  text: '#94A3B8',
}

interface MiniMap2DProps {
  objects: Map2DObject[]
  config: Map2DConfig
  tableStatuses: Map<string, 'available' | 'occupied' | 'reserved'>
  selectedTableId: string | null
  onClick: () => void
  width?: number
  height?: number
  className?: string
}

export function MiniMap2D({
  objects,
  config,
  tableStatuses,
  selectedTableId,
  onClick,
  width = 200,
  height = 150,
  className,
}: MiniMap2DProps) {
  const { t } = useTranslation()

  // Calculate scale to fit the world in the minimap
  const padding = 8
  const scale = useMemo(() => {
    const scaleX = (width - padding * 2) / config.width
    const scaleY = (height - padding * 2) / config.height
    return Math.min(scaleX, scaleY)
  }, [width, height, config.width, config.height, padding])

  // Sort all objects by layer order for proper z-ordering
  const sortedObjects = useMemo(() => {
    return [...objects].sort((a, b) => {
      const layerA = LAYER_ORDER[a.type] ?? 10
      const layerB = LAYER_ORDER[b.type] ?? 10
      return layerA - layerB
    })
  }, [objects])

  // Calculate offset to center
  const offsetX = (width - config.width * scale) / 2
  const offsetY = (height - config.height * scale) / 2

  // Get color for object based on type and status
  const getObjectColor = (obj: Map2DObject): string => {
    if (obj.type === 'table') {
      const status = tableStatuses.get(obj.id) ?? 'available'
      const isSelected = obj.id === selectedTableId
      return isSelected ? MINIMAP_COLORS.table.selected : MINIMAP_COLORS.table[status]
    }

    const colorMap: Record<string, string> = {
      wall: MINIMAP_COLORS.wall,
      door: MINIMAP_COLORS.door,
      window: MINIMAP_COLORS.window,
      kitchen: MINIMAP_COLORS.kitchen,
      bar: MINIMAP_COLORS.bar,
      chair: MINIMAP_COLORS.chair,
      decor: MINIMAP_COLORS.decor,
      model: MINIMAP_COLORS.model,
    }

    return colorMap[obj.type] ?? '#6B7280'
  }

  // Render object based on type
  const renderObject = (obj: Map2DObject) => {
    const isRotated90or270 = obj.rotation === 90 || obj.rotation === 270
    const w = (isRotated90or270 ? obj.depth : obj.width) * scale
    const h = (isRotated90or270 ? obj.width : obj.depth) * scale
    const x = offsetX + obj.x * scale
    const y = offsetY + obj.z * scale
    const color = getObjectColor(obj)
    const isSelected = obj.type === 'table' && obj.id === selectedTableId

    switch (obj.type) {
      case 'wall':
        return (
          <g key={obj.id}>
            {/* Shadow */}
            <rect
              x={x + 1}
              y={y + 1}
              width={w}
              height={h}
              fill={MAP2D_COLORS_PRO.wallShadow}
              rx={0.5}
            />
            {/* Main wall */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={color}
              rx={0.5}
            />
          </g>
        )

      case 'door':
        return (
          <g key={obj.id}>
            {/* Door frame */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="transparent"
              stroke={MAP2D_COLORS_PRO.doorFrame}
              strokeWidth={1}
              rx={0.5}
            />
            {/* Door swing indicator */}
            <path
              d={`M ${x + 2} ${y + h / 2} Q ${x + w / 2} ${y} ${x + w - 2} ${y + h / 2}`}
              fill="none"
              stroke={color}
              strokeWidth={0.5}
              strokeDasharray="2,1"
              opacity={0.7}
            />
          </g>
        )

      case 'window':
        return (
          <g key={obj.id}>
            {/* Window frame */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={MAP2D_COLORS_PRO.windowFrame}
              rx={0.5}
            />
            {/* Glass */}
            <rect
              x={x + 1}
              y={y + 1}
              width={w - 2}
              height={h - 2}
              fill={MAP2D_COLORS_PRO.windowGlass}
              rx={0.5}
            />
          </g>
        )

      case 'table':
        return (
          <g key={obj.id}>
            {/* Table shadow */}
            <rect
              x={x + 1}
              y={y + 1}
              width={w}
              height={h}
              fill="rgba(0,0,0,0.2)"
              rx={1}
            />
            {/* Table */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={MAP2D_COLORS_PRO.table}
              rx={1}
              opacity={isSelected ? 1 : 0.9}
            />
            {/* Status indicator */}
            <circle
              cx={x + w - 3}
              cy={y + 3}
              r={2}
              fill={color}
            />
            {/* Selection outline */}
            {isSelected && (
              <rect
                x={x - 1}
                y={y - 1}
                width={w + 2}
                height={h + 2}
                fill="none"
                stroke="#fff"
                strokeWidth={1}
                rx={2}
              />
            )}
          </g>
        )

      case 'chair':
        return (
          <g key={obj.id}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={color}
              rx={1}
              opacity={0.8}
            />
          </g>
        )

      case 'kitchen':
        return (
          <g key={obj.id}>
            {/* Shadow */}
            <rect
              x={x + 1}
              y={y + 1}
              width={w}
              height={h}
              fill="rgba(0,0,0,0.2)"
              rx={1}
            />
            {/* Main surface */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={color}
              rx={1}
            />
            {/* Burner indicators */}
            <circle cx={x + w * 0.3} cy={y + h * 0.3} r={Math.min(w, h) * 0.1} fill={MAP2D_COLORS_PRO.kitchenEquipment} />
            <circle cx={x + w * 0.7} cy={y + h * 0.3} r={Math.min(w, h) * 0.1} fill={MAP2D_COLORS_PRO.kitchenEquipment} />
            <circle cx={x + w * 0.3} cy={y + h * 0.7} r={Math.min(w, h) * 0.1} fill={MAP2D_COLORS_PRO.kitchenEquipment} />
            <circle cx={x + w * 0.7} cy={y + h * 0.7} r={Math.min(w, h) * 0.1} fill={MAP2D_COLORS_PRO.kitchenEquipment} />
          </g>
        )

      case 'bar':
        return (
          <g key={obj.id}>
            {/* Shadow */}
            <rect
              x={x + 1}
              y={y + 1}
              width={w}
              height={h}
              fill="rgba(0,0,0,0.2)"
              rx={w > h ? Math.min(w, h) * 0.2 : 1}
            />
            {/* Bar counter */}
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={color}
              rx={w > h ? Math.min(w, h) * 0.2 : 1}
            />
          </g>
        )

      case 'decor':
        return (
          <g key={obj.id}>
            {/* Plant circle */}
            <circle
              cx={x + w / 2}
              cy={y + h / 2}
              r={Math.min(w, h) * 0.4}
              fill={color}
              opacity={0.8}
            />
          </g>
        )

      case 'model':
        return (
          <g key={obj.id}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill={color}
              rx={1}
              strokeDasharray="2,1"
              stroke={MAP2D_COLORS_PRO.modelOutline}
              strokeWidth={0.5}
              opacity={0.7}
            />
          </g>
        )

      default:
        return (
          <rect
            key={obj.id}
            x={x}
            y={y}
            width={w}
            height={h}
            fill={obj.color ?? '#6B7280'}
            rx={1}
            opacity={0.8}
          />
        )
    }
  }

  return (
    <div
      className={cn(
        'group relative cursor-pointer overflow-hidden rounded-lg backdrop-blur-sm transition-all duration-200 hover:ring-2 hover:ring-primary/50',
        className
      )}
      style={{
        width,
        height,
        backgroundColor: MINIMAP_COLORS.background,
        border: `1px solid ${MINIMAP_COLORS.border}`,
      }}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      aria-label={t('pos.minimap.switchTo2D', 'Switch to 2D view')}
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-2 py-1 bg-slate-800/80 backdrop-blur-sm border-b border-slate-700/50 z-10">
        <div className="flex items-center gap-1.5">
          <Map className="h-3 w-3 text-slate-400" />
          <span className="text-[10px] font-medium text-slate-400">2D</span>
        </div>
        <ExternalLink className="h-3 w-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Map content */}
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="pt-5"
      >
        {/* Floor background */}
        <rect
          x={offsetX}
          y={offsetY}
          width={config.width * scale}
          height={config.height * scale}
          fill={MINIMAP_COLORS.floor}
          rx={2}
        />

        {/* Simple grid */}
        {config.showGrid && (
          <g>
            {Array.from({ length: Math.floor(config.width / 4) + 1 }).map((_, i) => (
              <line
                key={`v-${i}`}
                x1={offsetX + i * 4 * scale}
                y1={offsetY}
                x2={offsetX + i * 4 * scale}
                y2={offsetY + config.height * scale}
                stroke={MINIMAP_COLORS.gridLine}
                strokeWidth={0.5}
              />
            ))}
            {Array.from({ length: Math.floor(config.height / 4) + 1 }).map((_, i) => (
              <line
                key={`h-${i}`}
                x1={offsetX}
                y1={offsetY + i * 4 * scale}
                x2={offsetX + config.width * scale}
                y2={offsetY + i * 4 * scale}
                stroke={MINIMAP_COLORS.gridLine}
                strokeWidth={0.5}
              />
            ))}
          </g>
        )}

        {/* Floor border */}
        <rect
          x={offsetX}
          y={offsetY}
          width={config.width * scale}
          height={config.height * scale}
          fill="none"
          stroke={MINIMAP_COLORS.border}
          strokeWidth={1}
          rx={2}
        />

        {/* All objects (z-ordered) */}
        {sortedObjects.map(renderObject)}
      </svg>

      {/* Click hint */}
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[9px] text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity">
        {t('pos.minimap.clickToSwitch', 'Click to switch')}
      </div>
    </div>
  )
}

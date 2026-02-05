import type { TableVariation, TableLegStyle, TableTopShape, TableMaterial } from '../../types/voxel'

/**
 * Table style presets based on restaurant type
 */
export const TABLE_STYLE_PRESETS = {
  casual: {
    legStyle: 'modern' as TableLegStyle,
    topShape: 'rounded-square' as TableTopShape,
    material: 'wood-light' as TableMaterial,
  },
  formal: {
    legStyle: 'classic' as TableLegStyle,
    topShape: 'square' as TableTopShape,
    material: 'wood-dark' as TableMaterial,
  },
  modern: {
    legStyle: 'pedestal' as TableLegStyle,
    topShape: 'round' as TableTopShape,
    material: 'metal' as TableMaterial,
  },
  bistro: {
    legStyle: 'pedestal' as TableLegStyle,
    topShape: 'round' as TableTopShape,
    material: 'wood-dark' as TableMaterial,
  },
} as const

export type TableStylePreset = keyof typeof TABLE_STYLE_PRESETS

/**
 * Size-based variation rules
 */
interface SizeVariationRule {
  minWidth: number
  maxWidth: number
  minDepth: number
  maxDepth: number
  preferredStyles: TableVariation[]
}

const SIZE_VARIATION_RULES: SizeVariationRule[] = [
  // Small tables (2-person) - prefer round or small square
  {
    minWidth: 1,
    maxWidth: 2,
    minDepth: 1,
    maxDepth: 2,
    preferredStyles: [
      { legStyle: 'pedestal', topShape: 'round', material: 'wood-light' },
      { legStyle: 'modern', topShape: 'rounded-square', material: 'wood-light' },
    ],
  },
  // Medium tables (4-person) - flexible
  {
    minWidth: 2,
    maxWidth: 3.5,
    minDepth: 2,
    maxDepth: 3.5,
    preferredStyles: [
      { legStyle: 'modern', topShape: 'square', material: 'wood-light' },
      { legStyle: 'classic', topShape: 'rounded-square', material: 'wood-dark' },
      { legStyle: 'pedestal', topShape: 'round', material: 'metal' },
    ],
  },
  // Large tables (6+ person) - prefer rectangular
  {
    minWidth: 3.5,
    maxWidth: 10,
    minDepth: 2,
    maxDepth: 10,
    preferredStyles: [
      { legStyle: 'classic', topShape: 'square', material: 'wood-dark' },
      { legStyle: 'modern', topShape: 'square', material: 'wood-light' },
    ],
  },
]

/**
 * Select a table variation based on size
 */
export function selectVariation(
  width: number,
  depth: number,
  preferredPreset?: TableStylePreset
): TableVariation {
  // If preset is specified, use it
  if (preferredPreset && TABLE_STYLE_PRESETS[preferredPreset]) {
    return TABLE_STYLE_PRESETS[preferredPreset]
  }

  // Find matching size rule
  const matchingRule = SIZE_VARIATION_RULES.find(
    (rule) =>
      width >= rule.minWidth &&
      width <= rule.maxWidth &&
      depth >= rule.minDepth &&
      depth <= rule.maxDepth
  )

  if (matchingRule && matchingRule.preferredStyles.length > 0) {
    // Use deterministic selection based on size to maintain consistency
    const index = Math.floor((width * 7 + depth * 13) % matchingRule.preferredStyles.length)
    return matchingRule.preferredStyles[index]
  }

  // Default fallback
  return TABLE_STYLE_PRESETS.casual
}

/**
 * Get leg geometry parameters based on style
 */
export interface LegGeometry {
  type: 'cylinder' | 'box' | 'tapered'
  count: 1 | 4
  radius?: number
  width?: number
  depth?: number
  positions: [number, number][] // [xOffset, zOffset] from table corners
}

export function getLegGeometry(
  legStyle: TableLegStyle,
  tableWidth: number,
  tableDepth: number
): LegGeometry {
  const inset = 0.15 // How far legs are inset from edges

  switch (legStyle) {
    case 'pedestal':
      return {
        type: 'cylinder',
        count: 1,
        radius: Math.min(tableWidth, tableDepth) * 0.15,
        positions: [[tableWidth / 2, tableDepth / 2]],
      }

    case 'classic':
      return {
        type: 'tapered',
        count: 4,
        width: 0.08,
        depth: 0.08,
        positions: [
          [inset, inset],
          [tableWidth - inset, inset],
          [tableWidth - inset, tableDepth - inset],
          [inset, tableDepth - inset],
        ],
      }

    case 'modern':
    default:
      return {
        type: 'box',
        count: 4,
        width: 0.06,
        depth: 0.06,
        positions: [
          [inset, inset],
          [tableWidth - inset, inset],
          [tableWidth - inset, tableDepth - inset],
          [inset, tableDepth - inset],
        ],
      }
  }
}

/**
 * Get table top mesh parameters based on shape
 */
export interface TopGeometry {
  type: 'box' | 'cylinder'
  cornerRadius?: number
  segments?: number
}

export function getTopGeometry(topShape: TableTopShape): TopGeometry {
  switch (topShape) {
    case 'round':
      return {
        type: 'cylinder',
        segments: 32,
      }

    case 'rounded-square':
      return {
        type: 'box',
        cornerRadius: 0.1,
      }

    case 'square':
    default:
      return {
        type: 'box',
        cornerRadius: 0,
      }
  }
}

/**
 * Get material color based on material type
 */
export function getMaterialColors(material: TableMaterial): {
  base: string
  shadow: string
  highlight: string
} {
  switch (material) {
    case 'wood-dark':
      return {
        base: '#8B6914',
        shadow: '#5C4710',
        highlight: '#A67C00',
      }

    case 'metal':
      return {
        base: '#9CA3AF',
        shadow: '#6B7280',
        highlight: '#D1D5DB',
      }

    case 'wood-light':
    default:
      return {
        base: '#C4A77D',
        shadow: '#9E8660',
        highlight: '#DCC7A0',
      }
  }
}

/**
 * Generate a complete table configuration
 */
export interface TableConfiguration {
  variation: TableVariation
  legGeometry: LegGeometry
  topGeometry: TopGeometry
  colors: { base: string; shadow: string; highlight: string }
}

export function generateTableConfiguration(
  width: number,
  depth: number,
  preset?: TableStylePreset
): TableConfiguration {
  const variation = selectVariation(width, depth, preset)

  return {
    variation,
    legGeometry: getLegGeometry(variation.legStyle, width, depth),
    topGeometry: getTopGeometry(variation.topShape),
    colors: getMaterialColors(variation.material),
  }
}

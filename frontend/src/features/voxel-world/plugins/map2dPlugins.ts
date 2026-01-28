/**
 * Map2D Plugin Registry
 *
 * This module provides the infrastructure for extending the 2D Map view
 * with additional functionality through plugins.
 *
 * Currently this is a stub for future extensions. Planned plugins include:
 *
 * 1. Point Cloud Plugin
 *    - Import PLY/LAS point cloud data
 *    - Render as background layer
 *    - Auto-detect room boundaries
 *
 * 2. AI Generator Plugin
 *    - Upload floor plan images
 *    - Auto-detect furniture placement
 *    - Generate layout suggestions
 *
 * 3. Multi-floor Plugin
 *    - Layer system for different floors
 *    - Floor navigation and switching
 *    - Cross-floor object linking
 *
 * Example plugin implementation:
 *
 * ```typescript
 * import type { Map2DPluginDefinition } from '../types/map2d'
 *
 * const pointCloudPlugin: Map2DPluginDefinition = {
 *   id: 'point-cloud',
 *   name: 'Point Cloud',
 *   enabled: false,
 *   hooks: {
 *     onMapRender: (ctx) => {
 *       // Render point cloud data as background
 *     },
 *     renderOverlay: () => {
 *       // Return React component for plugin controls
 *       return <PointCloudControls />
 *     },
 *   },
 * }
 * ```
 */

import type { Map2DPluginDefinition } from '../types/map2d'

// Plugin registry (empty for now - to be populated with actual plugins)
const plugins: Map2DPluginDefinition[] = []

/**
 * Register a new plugin
 */
export function registerPlugin(plugin: Map2DPluginDefinition): void {
  const existingIndex = plugins.findIndex((p) => p.id === plugin.id)
  if (existingIndex >= 0) {
    plugins[existingIndex] = plugin
  } else {
    plugins.push(plugin)
  }
}

/**
 * Unregister a plugin by ID
 */
export function unregisterPlugin(pluginId: string): void {
  const index = plugins.findIndex((p) => p.id === pluginId)
  if (index >= 0) {
    plugins.splice(index, 1)
  }
}

/**
 * Get all registered plugins
 */
export function getPlugins(): readonly Map2DPluginDefinition[] {
  return plugins
}

/**
 * Get enabled plugins only
 */
export function getEnabledPlugins(): Map2DPluginDefinition[] {
  return plugins.filter((p) => p.enabled)
}

/**
 * Toggle plugin enabled state
 */
export function togglePlugin(pluginId: string, enabled: boolean): void {
  const plugin = plugins.find((p) => p.id === pluginId)
  if (plugin) {
    plugin.enabled = enabled
  }
}

/**
 * Get a plugin by ID
 */
export function getPlugin(pluginId: string): Map2DPluginDefinition | undefined {
  return plugins.find((p) => p.id === pluginId)
}

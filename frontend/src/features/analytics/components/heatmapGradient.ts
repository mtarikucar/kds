// Pure heatmap-legend gradient derivation, extracted verbatim from
// HeatmapLegend so it can be unit-tested without rendering a component.

// Locally defined since the voxel-world feature was removed; the heatmap
// legend itself is plain 2D and doesn't need the 3D module's types.
export type HeatmapColorScheme = 'viridis' | 'plasma' | 'coolwarm' | 'heat' | 'blues';

export type HeatmapOrientation = 'horizontal' | 'vertical';

export const COLOR_SCHEMES: Record<HeatmapColorScheme, string[]> = {
  viridis: ['#440154', '#482878', '#3e4a89', '#31688e', '#26838f', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  plasma: ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'],
  coolwarm: ['#3b4cc0', '#5977e3', '#7b9ff9', '#9ebeff', '#c0d4f5', '#f2cbb7', '#f7ac8e', '#ee8468', '#d65244', '#b40426'],
  heat: ['#000000', '#1a0000', '#4d0000', '#800000', '#b30000', '#e60000', '#ff1a1a', '#ff6666', '#ffb3b3', '#ffffff'],
  blues: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b', '#041f4d'],
};

/**
 * Build the CSS `linear-gradient(...)` string for a heatmap colour scheme.
 * Horizontal legends paint left-to-right (low → high); vertical legends
 * paint bottom-to-top so the high end sits visually above the low end.
 */
export function heatmapGradient(
  colorScheme: HeatmapColorScheme,
  orientation: HeatmapOrientation
): string {
  const colors = COLOR_SCHEMES[colorScheme];
  const direction = orientation === 'horizontal' ? 'to right' : 'to top';
  return `linear-gradient(${direction}, ${colors.join(', ')})`;
}

import { HeatmapColorScheme } from '../../voxel-world/components/HeatmapOverlay';
import { HeatmapLegend } from './HeatmapLegend';

export type HeatmapType = 'occupancy' | 'traffic' | 'dwell-time' | 'none';

interface HeatmapControlsProps {
  heatmapType: HeatmapType;
  onHeatmapTypeChange: (type: HeatmapType) => void;
  colorScheme: HeatmapColorScheme;
  onColorSchemeChange: (scheme: HeatmapColorScheme) => void;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  isLoading?: boolean;
}

const HEATMAP_TYPES: Array<{ value: HeatmapType; label: string; description: string }> = [
  { value: 'none', label: 'None', description: 'Hide heatmap' },
  { value: 'occupancy', label: 'Occupancy', description: 'Show customer density' },
  { value: 'traffic', label: 'Traffic Flow', description: 'Show movement patterns' },
  { value: 'dwell-time', label: 'Dwell Time', description: 'Show time spent in areas' },
];

const COLOR_SCHEMES: Array<{ value: HeatmapColorScheme; label: string }> = [
  { value: 'heat', label: 'Heat (Red)' },
  { value: 'viridis', label: 'Viridis (Green-Purple)' },
  { value: 'plasma', label: 'Plasma (Yellow-Purple)' },
  { value: 'coolwarm', label: 'Cool-Warm (Blue-Red)' },
  { value: 'blues', label: 'Blues' },
];

export function HeatmapControls({
  heatmapType,
  onHeatmapTypeChange,
  colorScheme,
  onColorSchemeChange,
  opacity,
  onOpacityChange,
  isLoading = false,
}: HeatmapControlsProps) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
      <h3 className="font-medium text-slate-900">Heatmap Settings</h3>

      {/* Heatmap Type Selection */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">Visualization Type</label>
        <div className="grid grid-cols-2 gap-2">
          {HEATMAP_TYPES.map((type) => (
            <button
              key={type.value}
              onClick={() => onHeatmapTypeChange(type.value)}
              disabled={isLoading}
              className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                heatmapType === type.value
                  ? 'bg-primary-50 border-primary-500 text-primary-700'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              } ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <span className="block font-medium">{type.label}</span>
              <span className="block text-xs opacity-70">{type.description}</span>
            </button>
          ))}
        </div>
      </div>

      {heatmapType !== 'none' && (
        <>
          {/* Color Scheme Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">Color Scheme</label>
            <select
              value={colorScheme}
              onChange={(e) => onColorSchemeChange(e.target.value as HeatmapColorScheme)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              {COLOR_SCHEMES.map((scheme) => (
                <option key={scheme.value} value={scheme.value}>
                  {scheme.label}
                </option>
              ))}
            </select>
          </div>

          {/* Opacity Slider */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">
              Opacity: {Math.round(opacity * 100)}%
            </label>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={opacity}
              onChange={(e) => onOpacityChange(parseFloat(e.target.value))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
            />
          </div>

          {/* Legend */}
          <div className="pt-2 border-t border-slate-100">
            <HeatmapLegend
              colorScheme={colorScheme}
              title={
                heatmapType === 'occupancy'
                  ? 'Customer Density'
                  : heatmapType === 'traffic'
                    ? 'Traffic Volume'
                    : 'Dwell Time'
              }
              minLabel="Low"
              maxLabel="High"
            />
          </div>
        </>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-2 text-sm text-slate-500">
          <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Loading heatmap data...
        </div>
      )}
    </div>
  );
}

export default HeatmapControls;

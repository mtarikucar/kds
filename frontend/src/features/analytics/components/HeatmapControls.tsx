import { useTranslation } from 'react-i18next';
import { HeatmapLegend, HeatmapColorScheme } from './HeatmapLegend';

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

const HEATMAP_TYPES: Array<{ value: HeatmapType; labelKey: string; descriptionKey: string }> = [
  { value: 'none', labelKey: 'heatmap.types.none.label', descriptionKey: 'heatmap.types.none.description' },
  { value: 'occupancy', labelKey: 'heatmap.types.occupancy.label', descriptionKey: 'heatmap.types.occupancy.description' },
  { value: 'traffic', labelKey: 'heatmap.types.traffic.label', descriptionKey: 'heatmap.types.traffic.description' },
  { value: 'dwell-time', labelKey: 'heatmap.types.dwellTime.label', descriptionKey: 'heatmap.types.dwellTime.description' },
];

const COLOR_SCHEMES: Array<{ value: HeatmapColorScheme; labelKey: string }> = [
  { value: 'heat', labelKey: 'heatmap.schemes.heat' },
  { value: 'viridis', labelKey: 'heatmap.schemes.viridis' },
  { value: 'plasma', labelKey: 'heatmap.schemes.plasma' },
  { value: 'coolwarm', labelKey: 'heatmap.schemes.coolwarm' },
  { value: 'blues', labelKey: 'heatmap.schemes.blues' },
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
  const { t } = useTranslation('analytics');
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
      <h3 className="font-medium text-slate-900">{t('heatmap.settings')}</h3>

      {/* Heatmap Type Selection */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-700">{t('heatmap.visualizationType')}</label>
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
              <span className="block font-medium">{t(type.labelKey)}</span>
              <span className="block text-xs opacity-70">{t(type.descriptionKey)}</span>
            </button>
          ))}
        </div>
      </div>

      {heatmapType !== 'none' && (
        <>
          {/* Color Scheme Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">{t('heatmap.colorScheme')}</label>
            <select
              value={colorScheme}
              onChange={(e) => onColorSchemeChange(e.target.value as HeatmapColorScheme)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              {COLOR_SCHEMES.map((scheme) => (
                <option key={scheme.value} value={scheme.value}>
                  {t(scheme.labelKey)}
                </option>
              ))}
            </select>
          </div>

          {/* Opacity Slider */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700">
              {t('heatmap.opacity', { percent: Math.round(opacity * 100) })}
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
                  ? t('heatmap.legend.customerDensity')
                  : heatmapType === 'traffic'
                    ? t('heatmap.legend.trafficVolume')
                    : t('heatmap.legend.dwellTime')
              }
              minLabel={t('heatmap.legend.low')}
              maxLabel={t('heatmap.legend.high')}
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
          {t('heatmap.loadingData')}
        </div>
      )}
    </div>
  );
}

export default HeatmapControls;

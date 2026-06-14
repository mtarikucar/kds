import { useMemo } from 'react';
import { heatmapGradient, type HeatmapColorScheme } from './heatmapGradient';

// Re-exported for existing importers; the canonical definition now lives in
// heatmapGradient so the pure gradient logic can be unit-tested in isolation.
export type { HeatmapColorScheme };

interface HeatmapLegendProps {
  colorScheme: HeatmapColorScheme;
  minLabel?: string;
  maxLabel?: string;
  title?: string;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export function HeatmapLegend({
  colorScheme,
  minLabel = 'Low',
  maxLabel = 'High',
  title,
  orientation = 'horizontal',
  className = '',
}: HeatmapLegendProps) {
  const gradientStyle = useMemo(
    () => ({ background: heatmapGradient(colorScheme, orientation) }),
    [colorScheme, orientation]
  );

  if (orientation === 'vertical') {
    return (
      <div className={`flex flex-col items-center gap-1 ${className}`}>
        {title && <span className="text-xs font-medium text-slate-600 mb-1">{title}</span>}
        <div className="flex items-center gap-2">
          <div className="w-4 h-32 rounded-sm shadow-inner" style={gradientStyle} />
          <div className="flex flex-col justify-between h-32 text-xs text-slate-500">
            <span>{maxLabel}</span>
            <span>{minLabel}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {title && <span className="text-xs font-medium text-slate-600">{title}</span>}
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 min-w-[40px]">{minLabel}</span>
        <div className="flex-1 h-3 rounded-sm shadow-inner min-w-[100px]" style={gradientStyle} />
        <span className="text-xs text-slate-500 min-w-[40px] text-right">{maxLabel}</span>
      </div>
    </div>
  );
}

export default HeatmapLegend;

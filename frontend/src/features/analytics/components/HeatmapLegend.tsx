import { useMemo } from 'react';
import { HeatmapColorScheme } from '../../voxel-world/components/HeatmapOverlay';

interface HeatmapLegendProps {
  colorScheme: HeatmapColorScheme;
  minLabel?: string;
  maxLabel?: string;
  title?: string;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

const COLOR_SCHEMES: Record<HeatmapColorScheme, string[]> = {
  viridis: ['#440154', '#482878', '#3e4a89', '#31688e', '#26838f', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  plasma: ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'],
  coolwarm: ['#3b4cc0', '#5977e3', '#7b9ff9', '#9ebeff', '#c0d4f5', '#f2cbb7', '#f7ac8e', '#ee8468', '#d65244', '#b40426'],
  heat: ['#000000', '#1a0000', '#4d0000', '#800000', '#b30000', '#e60000', '#ff1a1a', '#ff6666', '#ffb3b3', '#ffffff'],
  blues: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b', '#041f4d'],
};

export function HeatmapLegend({
  colorScheme,
  minLabel = 'Low',
  maxLabel = 'High',
  title,
  orientation = 'horizontal',
  className = '',
}: HeatmapLegendProps) {
  const gradientStyle = useMemo(() => {
    const colors = COLOR_SCHEMES[colorScheme];
    const direction = orientation === 'horizontal' ? 'to right' : 'to top';
    return {
      background: `linear-gradient(${direction}, ${colors.join(', ')})`,
    };
  }, [colorScheme, orientation]);

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

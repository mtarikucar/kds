import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import i18next from 'i18next';
import enAnalytics from '../../../i18n/locales/en/analytics.json';
import { HeatmapControls, type HeatmapType } from './HeatmapControls';
import type { HeatmapColorScheme } from './HeatmapLegend';

// HeatmapControls is a controlled presentational component: every input fires
// a callback with the next value, and the colour-scheme / opacity / legend
// block is gated behind heatmapType !== 'none'. We register the `analytics`
// namespace so labels read the real English copy, then drive each control.

beforeAll(() => {
  i18next.addResourceBundle('en', 'analytics', enAnalytics, true, true);
});

function setup(over: Partial<React.ComponentProps<typeof HeatmapControls>> = {}) {
  const onHeatmapTypeChange = vi.fn();
  const onColorSchemeChange = vi.fn();
  const onOpacityChange = vi.fn();
  const props = {
    heatmapType: 'occupancy' as HeatmapType,
    onHeatmapTypeChange,
    colorScheme: 'heat' as HeatmapColorScheme,
    onColorSchemeChange,
    opacity: 0.6,
    onOpacityChange,
    isLoading: false,
    ...over,
  };
  render(<HeatmapControls {...props} />);
  return { onHeatmapTypeChange, onColorSchemeChange, onOpacityChange };
}

describe('HeatmapControls', () => {
  it('renders the settings heading and the four visualization-type buttons', () => {
    setup();
    expect(screen.getByText('Heatmap Settings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /None/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Occupancy/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Traffic Flow/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dwell Time/ })).toBeInTheDocument();
  });

  it('fires onHeatmapTypeChange with the picked type', () => {
    const { onHeatmapTypeChange } = setup({ heatmapType: 'occupancy' });
    fireEvent.click(screen.getByRole('button', { name: /Traffic Flow/ }));
    expect(onHeatmapTypeChange).toHaveBeenCalledWith('traffic');
  });

  it('hides the colour-scheme / opacity / legend block when type is "none"', () => {
    setup({ heatmapType: 'none' });
    // Opacity label only renders for non-none types.
    expect(screen.queryByText(/Opacity:/)).not.toBeInTheDocument();
    expect(screen.queryByText('Color Scheme')).not.toBeInTheDocument();
  });

  it('shows the colour-scheme select and opacity slider for a non-none type', () => {
    setup({ heatmapType: 'occupancy', opacity: 0.6 });
    expect(screen.getByText('Color Scheme')).toBeInTheDocument();
    // opacity label interpolates the rounded percent.
    expect(screen.getByText('Opacity: 60%')).toBeInTheDocument();
  });

  it('fires onColorSchemeChange with the selected scheme', () => {
    const { onColorSchemeChange } = setup({ heatmapType: 'traffic', colorScheme: 'heat' });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'viridis' } });
    expect(onColorSchemeChange).toHaveBeenCalledWith('viridis');
  });

  it('fires onOpacityChange with the parsed float from the slider', () => {
    const { onOpacityChange } = setup({ heatmapType: 'occupancy', opacity: 0.6 });
    fireEvent.change(screen.getByRole('slider'), { target: { value: '0.9' } });
    expect(onOpacityChange).toHaveBeenCalledWith(0.9);
  });

  it('uses the occupancy legend title for an occupancy heatmap', () => {
    setup({ heatmapType: 'occupancy' });
    expect(screen.getByText('Customer Density')).toBeInTheDocument();
  });

  it('uses the traffic legend title for a traffic heatmap', () => {
    setup({ heatmapType: 'traffic' });
    expect(screen.getByText('Traffic Volume')).toBeInTheDocument();
  });

  it('disables the type buttons and shows the loading row when isLoading', () => {
    setup({ isLoading: true });
    expect(screen.getByText('Loading heatmap data...')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Occupancy/ })).toBeDisabled();
  });
});

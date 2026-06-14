import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeatmapLegend } from './HeatmapLegend';
import { heatmapGradient } from './heatmapGradient';

/**
 * HeatmapLegend is a pure presentational unit with one real branch:
 * orientation === 'vertical' swaps the DOM layout AND reverses the
 * max/min label order (max on top, min on bottom for a vertical bar),
 * whereas horizontal renders min..max left-to-right. The gradient style
 * must match heatmapGradient(scheme, orientation) exactly so the legend
 * actually mirrors the rendered heatmap. We assert both.
 */
describe('HeatmapLegend', () => {
  it('defaults to Low / High labels in horizontal orientation', () => {
    render(<HeatmapLegend colorScheme="heat" />);
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('renders a custom title when provided', () => {
    render(<HeatmapLegend colorScheme="viridis" title="Customer Density" />);
    expect(screen.getByText('Customer Density')).toBeInTheDocument();
  });

  it('does not render a title node when title is omitted', () => {
    const { container } = render(<HeatmapLegend colorScheme="heat" />);
    // Only the two label spans (min/max) — no title span.
    const spans = container.querySelectorAll('span');
    expect(spans).toHaveLength(2);
  });

  it('paints the horizontal gradient "to right" with the scheme colours', () => {
    const { container } = render(
      <HeatmapLegend colorScheme="plasma" minLabel="A" maxLabel="B" />,
    );
    const bar = container.querySelector('[style]') as HTMLElement;
    // jsdom normalises hex -> rgb(), so assert the direction (the real
    // orientation branch) plus a converted endpoint colour from the scheme.
    const gradient = heatmapGradient('plasma', 'horizontal');
    expect(gradient).toContain('to right'); // sanity: source is horizontal
    expect(bar.style.background).toContain('to right');
    expect(bar.style.background).not.toContain('to top');
    // plasma starts at #0d0887 -> rgb(13, 8, 135)
    expect(bar.style.background).toContain('rgb(13, 8, 135)');
  });

  it('paints "to top" and orders max-above-min when vertical', () => {
    const { container } = render(
      <HeatmapLegend
        colorScheme="blues"
        orientation="vertical"
        minLabel="MIN"
        maxLabel="MAX"
      />,
    );
    const bar = container.querySelector('[style]') as HTMLElement;
    expect(heatmapGradient('blues', 'vertical')).toContain('to top');
    expect(bar.style.background).toContain('to top');
    expect(bar.style.background).not.toContain('to right');

    // In vertical mode the label column lists max first, then min.
    const labels = Array.from(container.querySelectorAll('span'))
      .map((s) => s.textContent)
      .filter((t) => t === 'MIN' || t === 'MAX');
    expect(labels).toEqual(['MAX', 'MIN']);
  });
});

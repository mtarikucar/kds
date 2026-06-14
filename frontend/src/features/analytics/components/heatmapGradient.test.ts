import { describe, expect, it } from 'vitest';
import { COLOR_SCHEMES, heatmapGradient } from './heatmapGradient';

describe('heatmapGradient', () => {
  it('paints horizontal legends left-to-right', () => {
    const css = heatmapGradient('blues', 'horizontal');
    expect(css.startsWith('linear-gradient(to right, ')).toBe(true);
    // first colour of the scheme leads, last colour trails
    expect(css).toContain('#f7fbff');
    expect(css.endsWith('#041f4d)')).toBe(true);
  });

  it('paints vertical legends bottom-to-top', () => {
    const css = heatmapGradient('blues', 'vertical');
    expect(css.startsWith('linear-gradient(to top, ')).toBe(true);
  });

  it('joins all stops of the requested scheme in order', () => {
    const css = heatmapGradient('heat', 'horizontal');
    expect(css).toBe(`linear-gradient(to right, ${COLOR_SCHEMES.heat.join(', ')})`);
  });

  it('produces a distinct gradient per colour scheme', () => {
    const schemes = ['viridis', 'plasma', 'coolwarm', 'heat', 'blues'] as const;
    const rendered = schemes.map((s) => heatmapGradient(s, 'horizontal'));
    expect(new Set(rendered).size).toBe(schemes.length);
  });
});

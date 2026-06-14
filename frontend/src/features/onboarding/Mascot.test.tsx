import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Mascot } from './Mascot';

/**
 * Specs for Mascot — a presentational avatar. Key states: it renders the
 * variant-specific image by default; on an image load error it swaps to
 * the User fallback icon; and the `speaking` flag adds the pulse
 * indicator. The onboarding namespace isn't loaded in tests, so the alt
 * text resolves to its i18n key — we assert on that stable string.
 */

describe('Mascot', () => {
  it('renders the navbar variant image by default', () => {
    render(<Mascot />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toContain('voxel_chef_bottom.png');
  });

  it('renders the modal-variant image when variant=modal', () => {
    render(<Mascot variant="modal" />);
    expect(screen.getByRole('img').getAttribute('src')).toContain('voxel_chef_1_top_left.png');
  });

  it('falls back to the User icon when the image fails to load', () => {
    const { container } = render(<Mascot />);
    fireEvent.error(screen.getByRole('img'));
    // Image is gone; an SVG (the lucide User icon) replaces it.
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('shows the speaking pulse indicator only when speaking', () => {
    const { container, rerender } = render(<Mascot speaking={false} />);
    expect(container.querySelector('.animate-pulse')).toBeNull();
    rerender(<Mascot speaking />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('applies the size config (lg => 120px box)', () => {
    const { container } = render(<Mascot size="lg" />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.width).toBe('120px');
    expect(box.style.height).toBe('120px');
  });
});

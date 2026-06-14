import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Spinner from './Spinner';

describe('Spinner', () => {
  it('renders an animated svg', () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains('animate-spin')).toBe(true);
  });

  it('applies size classes', () => {
    const { container } = render(<Spinner size="lg" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('h-8');
  });

  it('applies color classes', () => {
    const { container } = render(<Spinner color="white" />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain('text-white');
  });

  it('merges a wrapper className', () => {
    const { container } = render(<Spinner className="my-wrapper" />);
    expect(
      (container.firstChild as HTMLElement).className,
    ).toContain('my-wrapper');
  });
});

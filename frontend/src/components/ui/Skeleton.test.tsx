import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Skeleton from './Skeleton';

describe('Skeleton', () => {
  it('renders a shimmer block with merged classes', () => {
    render(<Skeleton className="h-8 w-24" />);
    const el = screen.getByTestId('skeleton');
    expect(el.className).toContain('animate-shimmer');
    expect(el.className).toContain('h-8');
  });

  it('is aria-hidden so screen readers skip placeholders', () => {
    render(<Skeleton />);
    expect(screen.getByTestId('skeleton')).toHaveAttribute('aria-hidden', 'true');
  });
});

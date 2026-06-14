import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Badge from './Badge';

describe('Badge', () => {
  it('renders its children', () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('applies the variant classes', () => {
    render(<Badge variant="danger">Error</Badge>);
    expect(screen.getByText('Error').className).toContain('bg-red-50');
  });

  it('applies the size classes', () => {
    render(<Badge size="sm">Small</Badge>);
    expect(screen.getByText('Small').className).toContain('text-xs');
  });

  it('forwards extra props and merges custom classNames', () => {
    render(
      <Badge className="custom-class" data-testid="badge">
        Tag
      </Badge>,
    );
    const badge = screen.getByTestId('badge');
    expect(badge.className).toContain('custom-class');
    expect(badge.className).toContain('rounded-full');
  });

  it('forwards a ref to the underlying span', () => {
    let node: HTMLSpanElement | null = null;
    render(<Badge ref={(el) => (node = el)}>Ref</Badge>);
    expect(node).toBeInstanceOf(HTMLSpanElement);
  });
});

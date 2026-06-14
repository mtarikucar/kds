import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Package } from 'lucide-react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(
      <EmptyState
        title="No products yet"
        description="Add your first product to get started."
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'No products yet' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Add your first product to get started.'),
    ).toBeInTheDocument();
  });

  it('shows the action button only when both label and handler are given', async () => {
    const onAction = vi.fn();
    const { rerender } = render(
      <EmptyState title="Empty" actionLabel="Add product" onAction={onAction} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add product' }));
    expect(onAction).toHaveBeenCalledTimes(1);

    rerender(<EmptyState title="Empty" actionLabel="Add product" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('accepts a custom icon without exposing it to screen readers', () => {
    const { container } = render(<EmptyState icon={Package} title="Empty" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});

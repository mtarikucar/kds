import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SaveStatusIndicator } from './SaveStatusIndicator';

describe('SaveStatusIndicator', () => {
  it('renders nothing when idle and showIdle is false', () => {
    const { container } = render(<SaveStatusIndicator status="idle" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an idle indicator when showIdle is true', () => {
    const { container } = render(
      <SaveStatusIndicator status="idle" showIdle />,
    );
    expect(container.firstChild).not.toBeNull();
    expect((container.firstChild as HTMLElement).className).toContain(
      'text-slate-400',
    );
  });

  it('applies the saving color class', () => {
    const { container } = render(<SaveStatusIndicator status="saving" />);
    expect((container.firstChild as HTMLElement).className).toContain(
      'text-primary-500',
    );
  });

  it('applies the saved color class', () => {
    const { container } = render(<SaveStatusIndicator status="saved" />);
    expect((container.firstChild as HTMLElement).className).toContain(
      'text-green-600',
    );
  });

  it('shows a retry button on error and fires onRetry', async () => {
    const onRetry = vi.fn();
    render(<SaveStatusIndicator status="error" onRetry={onRetry} />);
    const button = screen.getByRole('button');
    await userEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the retry button on error when onRetry is absent', () => {
    render(<SaveStatusIndicator status="error" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from './switch';

describe('Switch', () => {
  it('renders with the correct aria-checked state', () => {
    render(<Switch checked />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('toggles to the opposite value on click', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onCheckedChange={onChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('does not fire when disabled', async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} disabled onCheckedChange={onChange} />);
    await userEvent
      .click(screen.getByRole('switch'))
      .catch(() => undefined);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('exposes data-state reflecting checked', () => {
    render(<Switch checked />);
    expect(screen.getByRole('switch')).toHaveAttribute(
      'data-state',
      'checked',
    );
  });

  it('applies size config classes', () => {
    render(<Switch size="sm" />);
    expect(screen.getByRole('switch').className).toContain('w-9');
  });
});

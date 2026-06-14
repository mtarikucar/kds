import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('renders a label associated with the input', () => {
    render(<Checkbox label="Accept terms" />);
    const input = screen.getByRole('checkbox', { name: 'Accept terms' });
    expect(input).toBeInTheDocument();
  });

  it('toggles and fires onChange when clicked', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Toggle me" onChange={onChange} />);
    const input = screen.getByRole('checkbox', { name: 'Toggle me' });
    await userEvent.click(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(input).toBeChecked();
  });

  it('renders an error message', () => {
    render(<Checkbox label="x" error="Required field" />);
    expect(screen.getByText('Required field')).toBeInTheDocument();
  });

  it('renders a description', () => {
    render(<Checkbox label="x" description="extra info" />);
    expect(screen.getByText('extra info')).toBeInTheDocument();
  });

  it('honors a caller-supplied id', () => {
    render(<Checkbox id="my-id" label="Labelled" />);
    expect(screen.getByRole('checkbox', { name: 'Labelled' })).toHaveAttribute(
      'id',
      'my-id',
    );
  });

  it('does not fire onChange when disabled', async () => {
    const onChange = vi.fn();
    render(<Checkbox label="x" disabled onChange={onChange} />);
    await userEvent
      .click(screen.getByRole('checkbox'))
      .catch(() => undefined);
    expect(onChange).not.toHaveBeenCalled();
  });
});

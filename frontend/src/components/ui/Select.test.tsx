import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from './Select';

function Harness({
  value,
  onValueChange,
}: {
  value?: string;
  onValueChange?: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} defaultValue="">
      <SelectTrigger>
        <SelectValue placeholder="Pick a fruit" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="apple">Apple</SelectItem>
        <SelectItem value="banana">Banana</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe('Select', () => {
  it('shows the placeholder when no value is selected', () => {
    render(<Harness />);
    expect(screen.getByText('Pick a fruit')).toBeInTheDocument();
  });

  it('opens the content on trigger click', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: 'Apple' })).toBeInTheDocument();
  });

  it('selects a value (uncontrolled) and closes', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', { name: 'Banana' }));
    // value now shown, content closed
    expect(screen.getByText('banana')).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Apple' }),
    ).not.toBeInTheDocument();
  });

  it('calls onValueChange when controlled', async () => {
    const onValueChange = vi.fn();
    render(<Harness value="apple" onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(screen.getByRole('option', { name: 'Banana' }));
    expect(onValueChange).toHaveBeenCalledWith('banana');
  });

  it('reflects expanded state via aria-expanded', async () => {
    render(<Harness />);
    const trigger = screen.getByRole('combobox');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('throws when sub-components are used outside Select', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(<SelectTrigger>orphan</SelectTrigger>),
    ).toThrow();
    spy.mockRestore();
  });
});

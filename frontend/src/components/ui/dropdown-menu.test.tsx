import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './dropdown-menu';

function Menu({ onSelect }: { onSelect?: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onSelect}>Edit</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

describe('DropdownMenu', () => {
  it('is closed by default', () => {
    render(<Menu />);
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
  });

  it('opens when the trigger is clicked', async () => {
    render(<Menu />);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('fires the item onClick then closes the menu', async () => {
    const onSelect = vi.fn();
    render(<Menu onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
  });

  it('supports asChild trigger and forwards the original onClick', async () => {
    const childClick = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" onClick={childClick}>
            Custom trigger
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Custom trigger' }),
    );
    expect(childClick).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Item')).toBeInTheDocument();
  });

  it('throws when sub-components are used outside DropdownMenu', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(<DropdownMenuTrigger>orphan</DropdownMenuTrigger>),
    ).toThrow();
    spy.mockRestore();
  });
});

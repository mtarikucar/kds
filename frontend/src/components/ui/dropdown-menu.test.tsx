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
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
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

/**
 * QR redesign hardening: the primitive is now used for a primary CTA
 * (hero download), which surfaced missing menu semantics and a trigger
 * toggle race (mousedown-outside closed, click re-opened).
 */
describe('DropdownMenu accessibility & dismissal', () => {
  it('closes on Escape', async () => {
    render(<Menu />);
    await userEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByText('Actions')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
  });

  it('exposes menu semantics on the trigger and content', async () => {
    render(<Menu />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
  });

  it('clicking the open trigger closes the menu instead of re-opening it', async () => {
    render(<Menu />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    await userEvent.click(trigger);
    expect(screen.getByText('Actions')).toBeInTheDocument();
    await userEvent.click(trigger);
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
  });

  it('passes className through to the positioning wrapper (full-width triggers)', () => {
    const { container } = render(
      <DropdownMenu className="w-full">
        <DropdownMenuTrigger>Open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Edit</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(container.querySelector('.w-full')).toBeTruthy();
  });
});

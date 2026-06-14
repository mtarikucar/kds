import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Modal from './Modal';

afterEach(() => {
  // ensure scroll lock state does not leak between tests
  document.body.style.overflow = 'unset';
});

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal isOpen={false} onClose={() => {}} title="Hello">
        body
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the dialog with title and children when open', () => {
    render(
      <Modal isOpen onClose={() => {}} title="Hello">
        body content
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('body content')).toBeInTheDocument();
  });

  it('locks body scroll while open', () => {
    render(
      <Modal isOpen onClose={() => {}}>
        body
      </Modal>,
    );
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose} title="Hello">
        body
      </Modal>,
    );
    await userEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen onClose={onClose}>
        body
      </Modal>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('wires aria-labelledby only when a title is given', () => {
    const { rerender } = render(
      <Modal isOpen onClose={() => {}} title="Has title">
        x
      </Modal>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby');

    rerender(
      <Modal isOpen onClose={() => {}}>
        x
      </Modal>,
    );
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-labelledby');
  });
});

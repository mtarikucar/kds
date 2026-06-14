import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PasswordInput } from './PasswordInput';

describe('PasswordInput', () => {
  it('renders a label and a password-type input by default', () => {
    render(<PasswordInput label="Password" />);
    expect(screen.getByText('Password')).toBeInTheDocument();
    const input = document.querySelector('input');
    expect(input).toHaveAttribute('type', 'password');
  });

  it('toggles visibility when the show/hide button is clicked', async () => {
    render(<PasswordInput label="Password" />);
    const input = document.querySelector('input')!;
    expect(input).toHaveAttribute('type', 'password');

    await userEvent.click(
      screen.getByRole('button', { name: 'Show password' }),
    );
    expect(input).toHaveAttribute('type', 'text');

    await userEvent.click(
      screen.getByRole('button', { name: 'Hide password' }),
    );
    expect(input).toHaveAttribute('type', 'password');
  });

  it('renders an error message', () => {
    render(<PasswordInput error="Too weak" />);
    expect(screen.getByText('Too weak')).toBeInTheDocument();
  });

  it('forwards typed input', async () => {
    render(<PasswordInput aria-label="pw" />);
    const input = document.querySelector('input')!;
    await userEvent.type(input, 'secret');
    expect((input as HTMLInputElement).value).toBe('secret');
  });
});

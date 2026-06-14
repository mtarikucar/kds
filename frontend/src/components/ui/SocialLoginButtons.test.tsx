import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// Stub framer-motion: render the real underlying tag (motion.button -> <button>)
// so click semantics survive, dropping only animation-only props.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_t, tag: string) => {
        return ({
          variants,
          initial,
          animate,
          whileHover,
          whileTap,
          ...props
        }: any) => {
          const Tag = tag as any;
          return <Tag {...props} />;
        };
      },
    },
  ),
}));

import { SocialLoginButtons } from './SocialLoginButtons';

describe('SocialLoginButtons', () => {
  it('renders the Google button', () => {
    render(<SocialLoginButtons onGoogleClick={() => {}} />);
    expect(
      screen.getByRole('button', { name: 'Continue with Google' }),
    ).toBeInTheDocument();
  });

  it('fires onGoogleClick when clicked', async () => {
    const onGoogleClick = vi.fn();
    render(<SocialLoginButtons onGoogleClick={onGoogleClick} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Continue with Google' }),
    );
    expect(onGoogleClick).toHaveBeenCalledTimes(1);
  });

  it('disables the button when disabled prop is set', () => {
    render(<SocialLoginButtons onGoogleClick={() => {}} disabled />);
    expect(
      screen.getByRole('button', { name: 'Continue with Google' }),
    ).toBeDisabled();
  });

  it('disables the button while loading', () => {
    render(<SocialLoginButtons onGoogleClick={() => {}} isLoading />);
    expect(
      screen.getByRole('button', { name: 'Continue with Google' }),
    ).toBeDisabled();
  });

  it('disables the button when no handler is provided', () => {
    render(<SocialLoginButtons />);
    expect(
      screen.getByRole('button', { name: 'Continue with Google' }),
    ).toBeDisabled();
  });

  it('uses the register divider text for the register variant', () => {
    render(<SocialLoginButtons onGoogleClick={() => {}} variant="register" />);
    expect(screen.getByText('or sign up with')).toBeInTheDocument();
  });
});

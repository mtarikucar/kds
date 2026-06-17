import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

// Stub the Google Identity Services button: render a plain button that hands
// back a fake ID token via onSuccess on click, so we can assert the wiring
// without the real GIS iframe / GoogleOAuthProvider.
vi.mock('@react-oauth/google', () => ({
  GoogleLogin: ({ onSuccess, text }: any) => (
    <button
      type="button"
      data-testid="gis-button"
      onClick={() => onSuccess({ credential: 'fake-id-token' })}
    >
      {text}
    </button>
  ),
}));

import { SocialLoginButtons } from './SocialLoginButtons';

describe('SocialLoginButtons', () => {
  it('renders the Google sign-in button and the login divider text', () => {
    render(<SocialLoginButtons onGoogleSuccess={() => {}} />);
    expect(screen.getByTestId('gis-button')).toBeInTheDocument();
    expect(screen.getByText('or continue with')).toBeInTheDocument();
  });

  it('calls onGoogleSuccess with the ID token credential on success', async () => {
    const onGoogleSuccess = vi.fn();
    render(<SocialLoginButtons onGoogleSuccess={onGoogleSuccess} />);
    await userEvent.click(screen.getByTestId('gis-button'));
    expect(onGoogleSuccess).toHaveBeenCalledWith('fake-id-token');
  });

  it('marks the button area disabled while a sign-in is in flight', () => {
    render(<SocialLoginButtons onGoogleSuccess={() => {}} disabled />);
    const wrapper = screen.getByTestId('gis-button').parentElement!;
    expect(wrapper).toHaveClass('pointer-events-none');
    expect(wrapper).toHaveAttribute('aria-disabled', 'true');
  });

  it('uses the register divider text for the register variant', () => {
    render(<SocialLoginButtons onGoogleSuccess={() => {}} variant="register" />);
    expect(screen.getByText('or sign up with')).toBeInTheDocument();
  });
});

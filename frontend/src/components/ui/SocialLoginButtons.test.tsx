import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  // The component renders nothing unless a Google client ID is configured for
  // the build (staging ships without one → Google off). Stub it for the
  // happy-path tests; the guard itself is covered separately below.
  beforeEach(() => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-google-client-id');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders nothing when no Google client ID is configured (staging)', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    const { container } = render(<SocialLoginButtons onGoogleSuccess={() => {}} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('gis-button')).toBeNull();
  });

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

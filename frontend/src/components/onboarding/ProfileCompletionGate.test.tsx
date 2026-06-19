import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ProfileCompletionGate from './ProfileCompletionGate';

let mockProfile: any = { phone: '+905551234567' };
let mockLoading = false;
vi.mock('../../features/auth/authApi', () => ({
  useProfile: () => ({ data: mockProfile, isLoading: mockLoading }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <ProfileCompletionGate>
              <div>APP CONTENT</div>
            </ProfileCompletionGate>
          }
        />
        <Route path="/welcome" element={<div>WELCOME PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProfileCompletionGate', () => {
  it('renders the app when the profile has a phone', () => {
    mockProfile = { phone: '+905551234567' };
    mockLoading = false;
    renderAt('/dashboard');
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
  });

  it('redirects to /welcome when the profile has no phone (social signup)', () => {
    mockProfile = { phone: null };
    renderAt('/dashboard');
    expect(screen.getByText('WELCOME PAGE')).toBeInTheDocument();
    expect(screen.queryByText('APP CONTENT')).not.toBeInTheDocument();
  });

  it('does NOT redirect a no-phone user on a recovery path (e.g. /legal)', () => {
    mockProfile = { phone: '' };
    renderAt('/legal/kvkk');
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
  });

  it('does not redirect while the profile is loading', () => {
    mockProfile = undefined;
    mockLoading = true;
    renderAt('/dashboard');
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
    mockLoading = false;
  });
});

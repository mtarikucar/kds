import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import SubscriptionGate from './SubscriptionGate';

// Mock the subscription context — the gate only reads { subscription, isLoading }.
let mockSub: any = { status: 'ACTIVE' };
let mockLoading = false;
vi.mock('../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ subscription: mockSub, isLoading: mockLoading }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={
            <SubscriptionGate>
              <div>APP CONTENT</div>
            </SubscriptionGate>
          }
        />
        <Route path="/subscription/plans" element={<div>PLANS SCREEN</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('SubscriptionGate (onboarding-trial lock)', () => {
  it('renders the app for a live (ACTIVE) tenant', () => {
    mockSub = { status: 'ACTIVE' };
    mockLoading = false;
    renderAt('/dashboard');
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
  });

  it('renders the app for a TRIALING tenant', () => {
    mockSub = { status: 'TRIALING' };
    renderAt('/dashboard');
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
  });

  it('LOCKS a TRIAL_ENDED tenant on a normal route → redirects to plans', () => {
    mockSub = { status: 'TRIAL_ENDED' };
    renderAt('/dashboard');
    expect(screen.getByText('PLANS SCREEN')).toBeInTheDocument();
    expect(screen.queryByText('APP CONTENT')).not.toBeInTheDocument();
  });

  it('does NOT redirect a locked tenant already on a recovery path', () => {
    mockSub = { status: 'TRIAL_ENDED' };
    renderAt('/subscription/checkout');
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
  });

  it('allows /admin/plan for a locked tenant (recovery path)', () => {
    mockSub = { status: 'TRIAL_ENDED' };
    renderAt('/admin/plan');
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
  });

  it('does not redirect while the subscription is still loading', () => {
    mockSub = undefined;
    mockLoading = true;
    renderAt('/dashboard');
    expect(screen.getByText('APP CONTENT')).toBeInTheDocument();
    mockLoading = false;
  });
});

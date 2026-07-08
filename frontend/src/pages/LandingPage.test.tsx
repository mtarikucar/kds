import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import LandingPage from './LandingPage';

const h = vi.hoisted(() => ({ token: null as string | null }));
vi.mock('../store/authStore', () => ({
  useAuthStore: (sel: (s: { accessToken: string | null }) => unknown) => sel({ accessToken: h.token }),
}));

beforeEach(() => {
  h.token = null;
});

describe('LandingPage (marketing homepage)', () => {
  it('renders the comprehensive homepage when logged out', () => {
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/tek panelden/i);
    // module appears in nav/grid/footer/spotlight
    expect(screen.getAllByText('QR Menü').length).toBeGreaterThan(0);
    // pricing teaser + faq are present
    expect(screen.getAllByText('En popüler').length).toBeGreaterThan(0);
    expect(screen.getByText('Sıkça sorulan sorular')).toBeInTheDocument();
    // honest delivery integrations, exactly the real platforms
    expect(screen.getByText('Yemeksepeti')).toBeInTheDocument();
    expect(screen.getByText('Migros Yemek')).toBeInTheDocument();
  });

  it('redirects logged-in visitors to the app', () => {
    h.token = 'access-token';
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/dashboard" element={<div>DASHBOARD</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('DASHBOARD')).toBeInTheDocument();
  });
});

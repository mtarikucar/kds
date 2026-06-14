import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TermsOfServicePage from './TermsOfServicePage';

function renderPage() {
  return render(
    <MemoryRouter>
      <TermsOfServicePage />
    </MemoryRouter>,
  );
}

describe('TermsOfServicePage', () => {
  it('renders the English terms heading and key sections', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Terms of Service' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '1. Acceptance of Terms' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '11. Contact Us' }),
    ).toBeInTheDocument();
  });

  it('renders the back-to-home default label (legal namespace not loaded)', () => {
    renderPage();
    expect(
      screen.getByRole('link', { name: /Back to Home/i }),
    ).toHaveAttribute('href', '/');
  });

  it('cross-links to the privacy policy in the footer', () => {
    renderPage();
    expect(
      screen.getByRole('link', { name: 'Privacy Policy' }),
    ).toHaveAttribute('href', '/privacy');
  });
});

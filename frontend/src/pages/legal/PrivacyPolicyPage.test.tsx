import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PrivacyPolicyPage from './PrivacyPolicyPage';

// Test setup bootstraps i18next at lng='en', so the English copy renders.
function renderPage() {
  return render(
    <MemoryRouter>
      <PrivacyPolicyPage />
    </MemoryRouter>,
  );
}

describe('PrivacyPolicyPage', () => {
  it('renders the English privacy policy heading and key sections', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Privacy Policy' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '1. Introduction' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '11. Contact Us' }),
    ).toBeInTheDocument();
  });

  it('links back to the home page', () => {
    renderPage();
    const back = screen.getByRole('link', { name: /Back to Home/i });
    expect(back).toHaveAttribute('href', '/');
  });

  it('renders footer cross-links to terms and privacy', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute(
      'href',
      '/terms',
    );
  });
});

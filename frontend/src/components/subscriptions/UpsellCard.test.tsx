import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import UpsellCard from './UpsellCard';

// Use the real `plan` i18n via defaultValue echoing — assert deep-link
// hrefs and conditional CTA rendering, which are the load-bearing behavior.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, opts?: any) =>
      typeof opts?.defaultValue === 'string' ? opts.defaultValue : _key,
  }),
}));

function renderCard(props: Parameters<typeof UpsellCard>[0] = {}) {
  return render(
    <MemoryRouter>
      <UpsellCard {...props} />
    </MemoryRouter>,
  );
}

describe('UpsellCard', () => {
  it('always renders the "upgrade plan" CTA pointing at /admin/plan', () => {
    renderCard();
    const planLink = screen.getByRole('link', { name: /Pakete Geç/i });
    expect(planLink).toHaveAttribute('href', '/admin/plan');
  });

  it('renders the add-on CTA with an encoded deep link when addOnCode is given', () => {
    renderCard({ addOnCode: 'fiscal pro' });
    const addOnLink = screen.getByRole('link', { name: /Eklentiyi Gör/i });
    // The code is URL-encoded into ?focus=
    expect(addOnLink).toHaveAttribute(
      'href',
      '/admin/marketplace?focus=fiscal%20pro',
    );
  });

  it('omits the add-on CTA entirely when no addOnCode is supplied', () => {
    renderCard({ planName: 'PRO' });
    expect(screen.queryByRole('link', { name: /Eklentiyi Gör/i })).toBeNull();
  });

  it('uses an explicit title/description over the generic copy', () => {
    renderCard({
      title: 'Fiscal entegrasyonu kilitli',
      description: 'Bu özellik için fiscal eklentisi gerekir.',
    });
    expect(screen.getByText('Fiscal entegrasyonu kilitli')).toBeInTheDocument();
    expect(
      screen.getByText('Bu özellik için fiscal eklentisi gerekir.'),
    ).toBeInTheDocument();
  });
});

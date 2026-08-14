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
  it('always renders the licence CTA pointing at /admin/license', () => {
    renderCard();
    const licenceLink = screen.getByRole('link', {
      name: /Lisansım ve modüllerim/i,
    });
    expect(licenceLink).toHaveAttribute('href', '/admin/license');
  });

  it('renders the store CTA with an encoded deep link when addOnCode is given', () => {
    renderCard({ addOnCode: 'fiscal pro' });
    const storeLink = screen.getByRole('link', { name: /Mağazada incele/i });
    // The code is URL-encoded into ?focus= on the catalog tab.
    expect(storeLink).toHaveAttribute(
      'href',
      '/admin/store?tab=catalog&focus=fiscal%20pro',
    );
  });

  it('falls back to the bare catalog link when no product is identified', () => {
    renderCard();
    const storeLink = screen.getByRole('link', { name: /Mağazada incele/i });
    expect(storeLink).toHaveAttribute('href', '/admin/store?tab=catalog');
  });

  it('omits the store CTA on a free-core screen, since there is nothing to sell', () => {
    renderCard({ freeCore: true });
    expect(
      screen.queryByRole('link', { name: /Mağazada incele/i }),
    ).toBeNull();
    // The licence CTA stays: it is how the tenant sees what they already own.
    expect(
      screen.getByRole('link', { name: /Lisansım ve modüllerim/i }),
    ).toBeInTheDocument();
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

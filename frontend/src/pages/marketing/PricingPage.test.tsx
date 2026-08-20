import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockPricing = vi.fn();
vi.mock('../../features/licensing/licensingApi', async () => {
  const actual = await vi.importActual<typeof import('../../features/licensing/licensingApi')>(
    '../../features/licensing/licensingApi',
  );
  return { ...actual, useCatalogPricing: () => mockPricing() };
});

import PricingPage from './PricingPage';

/**
 * The page renders the LIVE catalog. It used to render a hardcoded tier table,
 * which meant an operator changing a price in the superadmin panel left the
 * public site advertising an amount checkout would not honour. These tests pin
 * that the page has no opinion of its own about price.
 */
describe('PricingPage', () => {
  const product = (over: Record<string, unknown> = {}) => ({
    code: 'license_annual',
    name: 'Bakım, Destek ve Güncelleme',
    description: null,
    kind: 'license',
    billing: 'annual',
    priceCents: 299_000,
    currency: 'TRY',
    creditKind: null,
    creditUnits: null,
    requiresLicense: false,
    sortOrder: 0,
    ...over,
  });

  const renderPage = () =>
    render(
      <MemoryRouter>
        <PricingPage />
      </MemoryRouter>,
    );

  it('renders prices straight from the catalog', () => {
    mockPricing.mockReturnValue({
      data: [
        product(),
        product({
          code: 'advanced_reports',
          name: 'Gelişmiş Rapor',
          kind: 'module',
          priceCents: 129_000,
          requiresLicense: true,
          sortOrder: 10,
        }),
      ],
      isLoading: false,
    });
    renderPage();
    expect(screen.getByText(/2\.990,00/)).toBeInTheDocument();
    expect(screen.getByText(/1\.290,00/)).toBeInTheDocument();
  });

  it('leads with the free core rather than a price', () => {
    // The offer IS that a restaurant can run its floor without paying.
    mockPricing.mockReturnValue({ data: [product()], isLoading: false });
    renderPage();
    // The free-core block lists eleven capabilities; assert the block renders
    // rather than its translated copy (i18n resources are not loaded here).
    expect(screen.getByText(/freeCore\.items\.pos|POS/)).toBeInTheDocument();
  });

  it('renders nothing priced while the catalog is loading', () => {
    mockPricing.mockReturnValue({ data: undefined, isLoading: true });
    renderPage();
    expect(screen.queryByText(/₺/)).not.toBeInTheDocument();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * Specs for TableSelectionModal — review C5: the modal's fetch interpolates
 * tenantId into /tables/public/:tenantId. Both cart pages used to omit the
 * prop, so every dine-in guest hit /tables/public/undefined and the table
 * picker dead-ended. tenantId is REQUIRED now; assert the fetch URL actually
 * carries it.
 */

const get = vi.fn();
vi.mock('../../lib/api', () => ({
  default: { get: (...a: unknown[]) => get(...a) },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fb?: string) => (typeof fb === 'string' ? fb : k),
  }),
}));

import TableSelectionModal from './TableSelectionModal';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TableSelectionModal — C5 tenant-scoped fetch', () => {
  it('fetches the public tables of the GIVEN tenant (no /undefined dead-end)', async () => {
    get.mockResolvedValue({ data: [] });
    render(
      <TableSelectionModal
        isOpen
        onClose={vi.fn()}
        onSelectTable={vi.fn()}
        tenantId="tenant-42"
        primaryColor="#111"
      />,
    );

    await waitFor(() => expect(get).toHaveBeenCalled());
    const [url] = get.mock.calls[0] as [string];
    expect(url).toBe('/tables/public/tenant-42');
    expect(url).not.toContain('undefined');
  });

  it('renders the fetched tables', async () => {
    get.mockResolvedValue({
      data: [{ id: 'tb-1', number: 'A1', capacity: 4, status: 'AVAILABLE' }],
    });
    render(
      <TableSelectionModal
        isOpen
        onClose={vi.fn()}
        onSelectTable={vi.fn()}
        tenantId="tenant-42"
        primaryColor="#111"
      />,
    );
    await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());
  });
});

// GuidanceTab.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const createPO = vi.fn();
vi.mock('../../../features/stock-management/guidanceApi', () => ({ useGuidance: () => globalThis.__guidance }));
vi.mock('../../../features/stock-management/stockManagementApi', () => ({
  useCreatePurchaseOrder: () => ({ mutate: createPO, isPending: false }),
}));
vi.mock('../../../hooks/useFormatCurrency', () => ({ useFormatCurrency: () => (n: number) => `₺${n}` }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k) }) }));

import GuidanceTab from './GuidanceTab';

declare global { /* eslint-disable no-var */ var __guidance: any; /* eslint-enable no-var */ }

const q = (data: unknown) => ({ data, isLoading: false, isError: false });
const renderTab = () => render(<MemoryRouter><GuidanceTab /></MemoryRouter>);

beforeEach(() => {
  createPO.mockReset();
  globalThis.__guidance = q({
    volumeTier: 'SMALL_CAFE',
    buyList: [
      {
        stockItemId: 'i1', name: 'Dana Kıyma', unit: 'kg', currentStock: 1, par: 5, suggestedQty: 9,
        purchaseUnit: null, purchaseQty: null,
        recommended: { type: 'OWN_HISTORY', supplierId: 'A', supplierName: 'Kasap Ali', lastUnitPrice: 420, lastPurchaseAt: '2026-07-20', avgUnitPrice90d: 440, trendPct: 12, receiptCount: 3 },
        alternatives: [{ type: 'OWN_HISTORY', supplierId: 'B', supplierName: 'Metro', lastUnitPrice: 465, lastPurchaseAt: '2026-07-18', avgUnitPrice90d: 465, trendPct: null, receiptCount: 2 }],
      },
    ],
    channelGuide: Array.from({ length: 7 }, (_, i) => ({ categoryKey: ['MEAT','PRODUCE','DRY_GOODS','DAIRY','BEVERAGE','PACKAGING','CLEANING'][i], recommendationKey: `guide.rec.${i}`, detail: { channels: [], rules: [] } })),
  });
});

describe('GuidanceTab', () => {
  it('renders a buy-list row with supplier and price', () => {
    renderTab();
    expect(screen.getByText('Dana Kıyma')).toBeInTheDocument();
    expect(screen.getByText(/Kasap Ali/)).toBeInTheDocument();
    expect(screen.getByText(/₺420/)).toBeInTheDocument();
  });

  it('creates a draft PO for the recommended supplier group', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderTab();
    await user.click(screen.getByTestId('draft-po-A'));
    expect(createPO).toHaveBeenCalledTimes(1);
    const arg = createPO.mock.calls[0][0];
    expect(arg.supplierId).toBe('A');
    expect(arg.items).toEqual([{ stockItemId: 'i1', quantityOrdered: 9, unitPrice: 420 }]);
  });

  it('renders the 7-card channel guide', () => {
    renderTab();
    expect(screen.getAllByTestId('channel-card')).toHaveLength(7);
  });

  it('updates the channel card recommendation when the tier switcher changes', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    renderTab();
    expect(screen.getByText('guide.rec.MEAT.SMALL_CAFE')).toBeInTheDocument();
    await user.click(screen.getByText('MID_RESTAURANT'));
    expect(screen.getByText('guide.rec.MEAT.MID_RESTAURANT')).toBeInTheDocument();
    expect(screen.queryByText('guide.rec.MEAT.SMALL_CAFE')).not.toBeInTheDocument();
  });

  it('shows the empty state when nothing is below par', () => {
    globalThis.__guidance = q({ volumeTier: 'SMALL_CAFE', buyList: [], channelGuide: [] });
    renderTab();
    expect(screen.getByTestId('buylist-empty')).toBeInTheDocument();
  });

  it('fails soft on error', () => {
    globalThis.__guidance = { data: undefined, isLoading: false, isError: true };
    renderTab();
    expect(screen.getByTestId('guidance-error')).toBeInTheDocument();
  });
});

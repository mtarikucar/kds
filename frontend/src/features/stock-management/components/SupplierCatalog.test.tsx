import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const addItem = vi.fn();
const removeItem = vi.fn();
vi.mock('../stockManagementApi', () => ({
  useSuppliers: () => ({ data: [{ id: 'A', name: 'Kasap Ali' }], isLoading: false }),
  useSupplier: (id: string | null) => ({ data: id ? { id, name: 'Kasap Ali', supplierStockItems: [{ stockItemId: 'i1', stockItem: { name: 'Dana Kıyma', unit: 'kg' }, unitPrice: '420', supplierSku: 'KA-01', isPreferred: true }] } : undefined }),
  useStockItems: () => ({ data: [{ id: 'i1', name: 'Dana Kıyma', unit: 'kg' }, { id: 'i2', name: 'Kuzu', unit: 'kg' }] }),
  useAddSupplierItem: () => ({ mutate: addItem, isPending: false }),
  useRemoveSupplierItem: () => ({ mutate: removeItem, isPending: false }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k) }) }));

import SupplierCatalog from './SupplierCatalog';

describe('SupplierCatalog', () => {
  beforeEach(() => { addItem.mockReset(); removeItem.mockReset(); });

  it('lists a selected supplier\'s catalog items with price and preferred flag', () => {
    render(<SupplierCatalog />);
    expect(screen.getByText('Dana Kıyma')).toBeInTheDocument();
    expect(screen.getByText(/420/)).toBeInTheDocument();
    expect(screen.getByText('KA-01')).toBeInTheDocument();
  });

  it('removes a catalog link', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<SupplierCatalog />);
    await user.click(screen.getByTestId('remove-i1'));
    expect(removeItem).toHaveBeenCalledWith({ supplierId: 'A', stockItemId: 'i1' });
  });
});

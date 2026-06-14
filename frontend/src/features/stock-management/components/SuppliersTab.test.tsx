import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import i18next from 'i18next';
import enStock from '../../../i18n/locales/en/stock.json';
import type { Supplier } from '../types';

// SuppliersTab renders supplier cards and owns the same delete-confirm /
// create-vs-edit form-submit pattern as the other stock tabs. We mock the api
// hooks so we can assert the exact mutation + payload, register the `stock`
// namespace, and stub window.confirm for the delete gate.

const suppliers: { data: Supplier[]; isLoading: boolean } = { data: [], isLoading: false };
const createMutation = { mutateAsync: vi.fn(), isPending: false };
const updateMutation = { mutateAsync: vi.fn(), isPending: false };
const deleteMutation = { mutateAsync: vi.fn() };

vi.mock('../stockManagementApi', () => ({
  useSuppliers: () => suppliers,
  useCreateSupplier: () => createMutation,
  useUpdateSupplier: () => updateMutation,
  useDeleteSupplier: () => deleteMutation,
}));

import SuppliersTab from './SuppliersTab';

beforeAll(() => {
  i18next.addResourceBundle('en', 'stock', enStock, true, true);
});

function makeSupplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: 's-1',
    name: 'ACME Foods',
    contactName: 'Jane',
    email: 'jane@acme.test',
    phone: '+90 555',
    address: '',
    paymentTerms: '',
    notes: '',
    isActive: true,
    createdAt: 'x',
    updatedAt: 'x',
    ...over,
  } as unknown as Supplier;
}

describe('SuppliersTab', () => {
  beforeEach(() => {
    suppliers.data = [];
    suppliers.isLoading = false;
    createMutation.mutateAsync.mockReset();
    createMutation.isPending = false;
    updateMutation.mutateAsync.mockReset();
    deleteMutation.mutateAsync.mockReset();
    vi.restoreAllMocks();
  });

  it('shows the loading state while the suppliers query is pending', () => {
    suppliers.isLoading = true;
    render(<SuppliersTab />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows the empty state when there are no suppliers', () => {
    suppliers.data = [];
    render(<SuppliersTab />);
    expect(screen.getByText('No suppliers found')).toBeInTheDocument();
  });

  it('renders a supplier card with its name + contact + phone', () => {
    suppliers.data = [makeSupplier({ name: 'ACME Foods', contactName: 'Jane', phone: '+90 555 11' })];
    render(<SuppliersTab />);
    expect(screen.getByText('ACME Foods')).toBeInTheDocument();
    expect(screen.getByText('Jane')).toBeInTheDocument();
    expect(screen.getByText('+90 555 11')).toBeInTheDocument();
  });

  it('deletes a supplier only after window.confirm returns true', async () => {
    suppliers.data = [makeSupplier({ id: 'sup-9', name: 'ToDelete' })];
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SuppliersTab />);

    // The delete button is the second action button in the card.
    const card = screen.getByText('ToDelete').closest('.bg-white') as HTMLElement;
    const buttons = within(card).getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);

    expect(confirmSpy).toHaveBeenCalledWith('Delete this supplier?');
    await waitFor(() => expect(deleteMutation.mutateAsync).toHaveBeenCalledWith('sup-9'));
  });

  it('does NOT delete when window.confirm is cancelled', () => {
    suppliers.data = [makeSupplier({ id: 'sup-9', name: 'KeepMe' })];
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<SuppliersTab />);

    const card = screen.getByText('KeepMe').closest('.bg-white') as HTMLElement;
    const buttons = within(card).getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);
    expect(deleteMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it('opens the form for a NEW supplier and submits via createMutation', async () => {
    createMutation.mutateAsync.mockResolvedValue({});
    render(<SuppliersTab />);

    fireEvent.click(screen.getByRole('button', { name: /Add Supplier/ }));
    expect(screen.getByRole('heading', { name: 'Add Supplier' })).toBeInTheDocument();

    const form = screen.getByRole('button', { name: 'Save' }).closest('form')!;
    const nameInput = within(form).getAllByRole('textbox')[0] as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'New Vendor' } });
    fireEvent.submit(form);

    await waitFor(() => expect(createMutation.mutateAsync).toHaveBeenCalledTimes(1));
    expect(updateMutation.mutateAsync).not.toHaveBeenCalled();
    expect(createMutation.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Vendor' }),
    );
  });

  it('opens the form for an EXISTING supplier and submits via updateMutation with its id', async () => {
    updateMutation.mutateAsync.mockResolvedValue({});
    suppliers.data = [makeSupplier({ id: 'sup-7', name: 'Edit Me' })];
    render(<SuppliersTab />);

    const card = screen.getByText('Edit Me').closest('.bg-white') as HTMLElement;
    const buttons = within(card).getAllByRole('button');
    fireEvent.click(buttons[0]); // edit

    expect(screen.getByRole('heading', { name: 'Edit Supplier' })).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form')!);

    await waitFor(() => expect(updateMutation.mutateAsync).toHaveBeenCalledTimes(1));
    expect(createMutation.mutateAsync).not.toHaveBeenCalled();
    expect(updateMutation.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sup-7', data: expect.objectContaining({ name: 'Edit Me' }) }),
    );
  });
});

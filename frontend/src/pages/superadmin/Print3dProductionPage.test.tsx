import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import i18next from 'i18next';
import enSuperadmin from '../../i18n/locales/en/superadmin.json';

const jobs = { data: [] as any[], isLoading: false };
const updateStatus = { mutateAsync: vi.fn(), isPending: false };
const updateItem = { mutateAsync: vi.fn(), isPending: false };
const createShipment = { mutateAsync: vi.fn(), isPending: false };

vi.mock('../../features/superadmin/api/superadminPrint3dApi', () => ({
  useSaListPrint3dJobs: () => jobs,
  useSaGetPrint3dJob: (id?: string) => ({
    data: id ? jobs.data.find((j) => j.id === id) : undefined,
  }),
  useSaUpdatePrint3dJobStatus: () => updateStatus,
  useSaUpdatePrint3dJobItem: () => updateItem,
  useSaCreateShipment: () => createShipment,
  useSaMarkShipmentDelivered: () => ({ mutateAsync: vi.fn(), isPending: false }),
  saPrint3dKeys: { jobs: () => ['sa', 'print3d', 'jobs'], job: (id: string) => ['sa', 'print3d', 'job', id] },
}));

// useFormatCurrencyExtended -> useCountryProfile -> useGetTenantSettings ->
// react-query. This panel spans every tenant (each job carries its OWN
// frozen currency), so it uses formatWithCurrency's explicit-override path,
// not the "current tenant's own currency" path — but the hook still calls
// useCountryProfile() unconditionally, so the underlying query hook is
// stubbed the same way InvoicesPage.test.tsx does it, keeping this test
// free of a QueryClientProvider and any live network call.
vi.mock('../../hooks/useCurrency', () => ({
  useCurrency: () => 'TRY',
  useGetTenantSettings: () => ({ data: undefined }),
}));

import Print3dProductionPage from './Print3dProductionPage';

beforeAll(() => {
  i18next.addResourceBundle('en', 'superadmin', enSuperadmin, true, true);
});

const job = {
  id: 'job-1',
  tenantId: 't-1',
  tenantName: 'Test Restoran',
  status: 'queued',
  partner: 'figurunica',
  partnerRef: null,
  itemCount: 2,
  totalCents: 160000,
  currency: 'TRY',
  note: null,
  createdAt: '2026-08-20T10:00:00.000Z',
  hwOrderId: 'hw-1',
  items: [
    { id: 'i1', productName: 'Adana Kebap', productImageUrl: '/img/a.jpg', model3dUrl: null, position: 0, status: 'pending', opsNote: null },
    { id: 'i2', productName: 'Lahmacun', productImageUrl: null, model3dUrl: 'https://cdn/l.glb', position: 1, status: 'pending', opsNote: null },
  ],
  hwOrder: {
    id: 'hw-1',
    status: 'paid',
    shippingAddress: { line1: 'Bağdat Cad. 1', city: 'İstanbul' },
    shipments: [],
  },
};

describe('Print3dProductionPage', () => {
  beforeEach(() => {
    jobs.data = [job];
    updateStatus.mutateAsync.mockReset();
    updateStatus.mutateAsync.mockResolvedValue({});
    createShipment.mutateAsync.mockReset();
    createShipment.mutateAsync.mockResolvedValue({});
    updateItem.mutateAsync.mockReset();
    updateItem.mutateAsync.mockResolvedValue({});
  });

  it('lists queued jobs with tenant, item count and total', () => {
    render(<Print3dProductionPage />);
    expect(screen.getByText('Test Restoran')).toBeTruthy();
    expect(screen.getByTestId('print3d-row-job-1').textContent).toContain('2');
    // Country-profile-driven formatting (formatWithCurrency), not a
    // hardcoded tr-TR toLocaleString — under the test env's 'en' locale
    // that renders "TRY 1,600.00", not the tr-TR "1.600,00" grouping.
    expect(screen.getByTestId('print3d-row-job-1').textContent).toContain('1,600.00');
  });

  it('shows the Figurunica manifest with product name and photo per item', () => {
    render(<Print3dProductionPage />);
    fireEvent.click(screen.getByTestId('print3d-open-job-1'));
    // The manifest title also appears as the row's "open" link text, so
    // scope to the heading.
    expect(screen.getByRole('heading', { name: enSuperadmin.print3d.manifest.title })).toBeTruthy();
    expect(screen.getByText('Adana Kebap')).toBeTruthy();
    expect(screen.getByAltText('Adana Kebap')).toHaveAttribute('src', '/img/a.jpg');
    expect(screen.getByText('Lahmacun')).toBeTruthy();
  });

  it('advances a job from queued to in_production', async () => {
    render(<Print3dProductionPage />);
    fireEvent.click(screen.getByTestId('print3d-open-job-1'));
    fireEvent.click(screen.getByTestId('print3d-advance'));
    await waitFor(() => expect(updateStatus.mutateAsync).toHaveBeenCalled());
    expect(updateStatus.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'job-1', status: 'in_production' }),
    );
  });

  it('marks a single manifest item as rejected through the item endpoint', async () => {
    // 'rejected' is the operator's "this figurine must be reprinted"
    // signal; leaving it read-only would leave PATCH
    // /jobs/:id/items/:itemId dead.
    render(<Print3dProductionPage />);
    fireEvent.click(screen.getByTestId('print3d-open-job-1'));
    fireEvent.change(screen.getByTestId('print3d-item-status-i1'), {
      target: { value: 'rejected' },
    });
    await waitFor(() => expect(updateItem.mutateAsync).toHaveBeenCalled());
    expect(updateItem.mutateAsync).toHaveBeenCalledWith({
      jobId: 'job-1',
      itemId: 'i1',
      status: 'rejected',
    });
  });

  it('shows the delivery address and creates a shipment through the existing shipments rail', async () => {
    render(<Print3dProductionPage />);
    fireEvent.click(screen.getByTestId('print3d-open-job-1'));
    expect(screen.getByTestId('print3d-address').textContent).toContain('Bağdat Cad. 1');
    fireEvent.change(screen.getByPlaceholderText('Yurtiçi Kargo'), {
      target: { value: 'Aras' },
    });
    fireEvent.click(screen.getByTestId('print3d-create-shipment'));
    await waitFor(() => expect(createShipment.mutateAsync).toHaveBeenCalled());
    // No new backend endpoint: the existing superadmin/shipments rail is
    // called with the ORDER id, not the job id.
    expect(createShipment.mutateAsync).toHaveBeenCalledWith({
      orderId: 'hw-1',
      carrier: 'Aras',
    });
  });

  it('shows the empty copy when no job is in the selected state', () => {
    jobs.data = [];
    render(<Print3dProductionPage />);
    expect(screen.getByText(enSuperadmin.print3d.empty)).toBeTruthy();
  });

  describe('exports a client-side CSV manifest', () => {
    beforeEach(() => {
      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:mock'),
        revokeObjectURL: vi.fn(),
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it('downloads the manifest for the open job', () => {
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      render(<Print3dProductionPage />);
      fireEvent.click(screen.getByTestId('print3d-open-job-1'));
      fireEvent.click(screen.getByTestId('print3d-csv'));
      expect(clickSpy).toHaveBeenCalled();
      expect((window.URL.createObjectURL as any)).toHaveBeenCalled();
    });
  });

  // v3.7.0 — Görev 10's state machine (Print3dService.TRANSITIONS) refuses
  // any transition it doesn't list, refuses a same-status repeat, and
  // refuses every out-edge from produced/cancelled (PRINT3D_INVALID_TRANSITION,
  // prisma.print3dJob.update never called — see print3d.service.spec.ts).
  // An operator clicking a control and getting that error back is a UI bug:
  // this proves the panel's Advance/Cancel controls are enabled on a given
  // status if and only if the machine allows that edge from that status,
  // for EVERY status — not just the one the example wizard happened to
  // click through.
  const TRANSITIONS: Record<string, readonly string[]> = {
    queued: ['in_production', 'cancelled'],
    in_production: ['produced', 'cancelled'],
    produced: [],
    cancelled: [],
  };

  it.each(Object.entries(TRANSITIONS))(
    "status '%s' — controls are enabled iff the state machine allows them (allowed: %j)",
    async (status, allowed) => {
      jobs.data = [{ ...job, id: 'job-x', status }];
      render(<Print3dProductionPage />);
      fireEvent.click(screen.getByTestId('print3d-open-job-x'));

      const advanceTarget = allowed.find((s) => s !== 'cancelled') ?? null;
      const canCancel = allowed.includes('cancelled');

      const advanceBtn = screen.getByTestId('print3d-advance') as HTMLButtonElement;
      const cancelBtn = screen.getByTestId('print3d-cancel') as HTMLButtonElement;

      expect(advanceBtn.disabled).toBe(!advanceTarget);
      expect(cancelBtn.disabled).toBe(!canCancel);

      // A disabled control must never reach the mutation, whether or not it
      // is clicked — jsdom (like real browsers) doesn't dispatch click on a
      // disabled button, but we assert the outcome directly rather than
      // trust that.
      fireEvent.click(advanceBtn);
      if (advanceTarget) {
        await waitFor(() =>
          expect(updateStatus.mutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'job-x', status: advanceTarget }),
          ),
        );
      } else {
        expect(updateStatus.mutateAsync).not.toHaveBeenCalled();
      }

      updateStatus.mutateAsync.mockClear();
      fireEvent.click(cancelBtn);
      if (canCancel) {
        await waitFor(() =>
          expect(updateStatus.mutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'job-x', status: 'cancelled' }),
          ),
        );
      } else {
        expect(updateStatus.mutateAsync).not.toHaveBeenCalled();
      }
    },
  );
});

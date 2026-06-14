import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AuditLogsPage from './AuditLogsPage';

const exportAsync = vi.fn();
let logsData: any;
let logsArg: any;
let logsLoading = false;
let exportPending = false;

vi.mock('../../features/superadmin/api/superAdminApi', () => ({
  useAuditLogs: (filters: any) => {
    logsArg = filters;
    return { data: logsData, isLoading: logsLoading };
  },
  useExportAuditLogs: () => ({ mutateAsync: exportAsync, isPending: exportPending }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: any) => {
      if (arg && typeof arg === 'object' && Object.keys(arg).length) {
        return `${key}::${Object.values(arg).join(',')}`;
      }
      return key;
    },
  }),
}));

function log(over: Partial<any> = {}) {
  return {
    id: 'l1',
    action: 'SUSPEND',
    entityType: 'TENANT',
    entityId: 'abcdef1234567890',
    actorId: 'admin-1',
    actorEmail: 'ops@kds.dev',
    targetTenantName: 'Acme Diner',
    createdAt: '2026-06-01T10:00:00.000Z',
    ...over,
  };
}

function payload(logs: any[], meta: Partial<any> = {}) {
  return { data: logs, meta: { total: logs.length, page: 1, limit: 50, totalPages: 1, ...meta } };
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AuditLogsPage />
    </QueryClientProvider>,
  );
}

describe('AuditLogsPage — export flow', () => {
  beforeEach(() => {
    exportAsync.mockReset().mockResolvedValue(new Blob(['a,b,c']));
    exportPending = false;
    logsLoading = false;
    logsData = payload([log()]);
    // jsdom has no real object-URL / download plumbing.
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('CSV export calls the mutation with the current filters + format=csv', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'auditLogs.csv' }));
    await vi.waitFor(() => expect(exportAsync).toHaveBeenCalledTimes(1));
    expect(exportAsync).toHaveBeenCalledWith(expect.objectContaining({ format: 'csv', page: 1, limit: 50 }));
    expect(clickSpy).toHaveBeenCalled();
  });

  it('JSON export calls the mutation with format=json', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'auditLogs.json' }));
    await vi.waitFor(() => expect(exportAsync).toHaveBeenCalledTimes(1));
    expect(exportAsync.mock.calls[0][0]).toMatchObject({ format: 'json' });
  });

  it('disables both export buttons while an export is pending', () => {
    exportPending = true;
    renderPage();
    expect(screen.getByRole('button', { name: 'auditLogs.csv' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'auditLogs.json' })).toBeDisabled();
  });

  it('export buttons are enabled when no export is in flight', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'auditLogs.csv' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'auditLogs.json' })).not.toBeDisabled();
  });
});

describe('AuditLogsPage — table & filters', () => {
  beforeEach(() => {
    logsLoading = false;
    logsData = payload([log()]);
  });
  afterEach(() => {
    logsLoading = false;
    vi.restoreAllMocks();
  });

  it('renders an audit row: actor email, action badge, entity type and truncated id', () => {
    renderPage();
    expect(screen.getByText('ops@kds.dev')).toBeInTheDocument();
    expect(screen.getByText('SUSPEND')).toBeInTheDocument();
    expect(screen.getByText('TENANT')).toBeInTheDocument();
    // entityId rendered truncated to first 8 chars
    expect(screen.getByText('(abcdef12...)')).toBeInTheDocument();
    expect(screen.getByText('Acme Diner')).toBeInTheDocument();
  });

  it('renders the em-dash when there is no target tenant', () => {
    logsData = payload([log({ targetTenantName: undefined })]);
    renderPage();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('action filter feeds the query and resets to page 1', () => {
    renderPage();
    const actionSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(actionSelect, { target: { value: 'DELETE' } });
    expect(logsArg).toMatchObject({ action: 'DELETE', page: 1 });
  });

  it('shows the spinner row (no data rows) while loading', () => {
    logsLoading = true;
    logsData = undefined;
    renderPage();
    // The loading branch renders a single spinner row, never the data rows.
    expect(screen.queryByText('ops@kds.dev')).not.toBeInTheDocument();
    // header is still present (the page chrome renders regardless).
    expect(screen.getByText('auditLogs.col.actor')).toBeInTheDocument();
  });

  it('paginates: Next advances the filter page', () => {
    logsData = payload([log()], { page: 1, totalPages: 4, total: 200 });
    renderPage();
    const next = screen.getByRole('button', { name: 'common.next' });
    expect(screen.getByRole('button', { name: 'common.previous' })).toBeDisabled();
    fireEvent.click(next);
    expect(logsArg.page).toBe(2);
  });
});

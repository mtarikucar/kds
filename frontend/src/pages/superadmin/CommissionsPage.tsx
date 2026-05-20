import { useMemo, useState } from 'react';
import { Coins, CheckCircle2, Download } from 'lucide-react';
import { toast } from 'sonner';
import {
  useSuperAdminCommissions,
  useBulkApproveCommissions,
  useExportCommissions,
  type SuperAdminCommissionFilter,
} from '../../features/superadmin/api/superAdminApi';

const TYPE_BADGE: Record<string, string> = {
  SIGNUP: 'bg-indigo-100 text-indigo-800',
  RENEWAL: 'bg-teal-100 text-teal-800',
  UPSELL: 'bg-fuchsia-100 text-fuchsia-800',
};
const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-blue-100 text-blue-800',
  PAID: 'bg-emerald-100 text-emerald-800',
};

/**
 * Platform-wide commissions view. Mirrors the data the marketer panel
 * shows but spans every marketer and supports bulk-approve + CSV
 * export. Selection uses controlled checkboxes; only PENDING rows are
 * eligible (bulk-approve server-side skips the others with a reason).
 */
export default function CommissionsPage() {
  const [filter, setFilter] = useState<SuperAdminCommissionFilter>({
    page: 1,
    limit: 25,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading } = useSuperAdminCommissions(filter);
  const bulkApprove = useBulkApproveCommissions();
  const exportCsv = useExportCommissions();

  const rows = data?.data ?? [];
  const meta = data?.meta;

  const pendingSelected = useMemo(
    () =>
      rows.filter((r) => selected.has(r.id) && r.status === 'PENDING').map((r) => r.id),
    [rows, selected],
  );

  const toggleRow = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleAll = () => {
    if (selected.size === rows.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(rows.map((r) => r.id)));
    }
  };

  const handleBulkApprove = () => {
    if (pendingSelected.length === 0) {
      toast.error('Onaylanabilecek PENDING komisyon seçilmedi');
      return;
    }
    if (
      !window.confirm(
        `${pendingSelected.length} PENDING komisyonu onaylamak istediğinize emin misiniz?`,
      )
    )
      return;
    bulkApprove.mutate(pendingSelected, {
      onSuccess: (res: any) => {
        toast.success(
          `${res?.approvedCount ?? 0} onaylandı, ${res?.skippedCount ?? 0} atlandı`,
        );
        setSelected(new Set());
      },
      onError: () => toast.error('Toplu onay başarısız'),
    });
  };

  const handleExportCsv = () => {
    exportCsv.mutate(filter, {
      onSuccess: (blob: any) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `commissions-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      onError: () => toast.error('CSV indirilemedi'),
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Coins className="w-6 h-6 text-zinc-700" />
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Komisyonlar</h1>
          <p className="text-sm text-zinc-500">
            Platform genelinde pazarlamacı komisyon hareketleri.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <select
            value={filter.type ?? ''}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                page: 1,
                type: (e.target.value || undefined) as any,
              }))
            }
            className="px-3 py-2 border border-zinc-300 rounded-lg text-sm"
          >
            <option value="">Tüm tipler</option>
            <option value="SIGNUP">SIGNUP</option>
            <option value="RENEWAL">RENEWAL</option>
            <option value="UPSELL">UPSELL</option>
          </select>
          <select
            value={filter.status ?? ''}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                page: 1,
                status: (e.target.value || undefined) as any,
              }))
            }
            className="px-3 py-2 border border-zinc-300 rounded-lg text-sm"
          >
            <option value="">Tüm durumlar</option>
            <option value="PENDING">PENDING</option>
            <option value="APPROVED">APPROVED</option>
            <option value="PAID">PAID</option>
          </select>
          <input
            type="month"
            value={filter.period ?? ''}
            onChange={(e) =>
              setFilter((f) => ({
                ...f,
                page: 1,
                period: e.target.value || undefined,
              }))
            }
            className="px-3 py-2 border border-zinc-300 rounded-lg text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleBulkApprove}
              disabled={pendingSelected.length === 0 || bulkApprove.isPending}
              className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              Toplu onayla ({pendingSelected.length})
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              disabled={exportCsv.isPending}
              className="inline-flex items-center justify-center gap-1 px-3 py-2 bg-zinc-100 text-zinc-700 rounded-lg text-sm hover:bg-zinc-200 disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              CSV
            </button>
          </div>
        </div>
        {data?.summary && (
          <p className="mt-3 text-xs text-zinc-500">
            Filtreyle eşleşen {data.summary.totalCount} kayıt — Toplam{' '}
            <span className="font-semibold text-zinc-700">
              ₺{Number(data.summary.totalAmount).toFixed(2)}
            </span>
          </p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-left text-zinc-500 text-xs uppercase tracking-wide">
                <th className="px-3 py-3 w-8">
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-3 py-3 font-medium">Tarih</th>
                <th className="px-3 py-3 font-medium">Periyot</th>
                <th className="px-3 py-3 font-medium">Tip</th>
                <th className="px-3 py-3 font-medium">Durum</th>
                <th className="px-3 py-3 font-medium text-right">Tutar</th>
                <th className="px-3 py-3 font-medium">Pazarlamacı</th>
                <th className="px-3 py-3 font-medium">Tenant</th>
                <th className="px-3 py-3 font-medium">Lead</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-zinc-500">
                    Yükleniyor...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-zinc-500">
                    Komisyon bulunamadı
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-50">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() => toggleRow(r.id)}
                      />
                    </td>
                    <td className="px-3 py-3 text-zinc-500 text-xs">
                      {new Date(r.createdAt).toLocaleDateString('tr-TR')}
                    </td>
                    <td className="px-3 py-3 font-medium text-zinc-900">{r.period}</td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[r.type] ?? 'bg-zinc-100'}`}
                      >
                        {r.type}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[r.status] ?? 'bg-zinc-100'}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-medium text-zinc-900">
                      ₺{Number(r.amount).toFixed(2)}
                    </td>
                    <td className="px-3 py-3 text-zinc-700">
                      {r.marketingUser
                        ? `${r.marketingUser.firstName} ${r.marketingUser.lastName}`
                        : '—'}
                      {r.marketingUser?.referralCode && (
                        <div className="text-xs text-zinc-400 font-mono">
                          {r.marketingUser.referralCode}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-zinc-700">{r.tenant?.name ?? '—'}</td>
                    <td className="px-3 py-3 text-zinc-500 text-xs">
                      {r.lead ? (
                        <>
                          {r.lead.businessName}{' '}
                          <span className="text-zinc-400">({r.lead.source})</span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {meta && meta.totalPages > 1 && (
          <div className="border-t border-zinc-100 px-4 py-3 flex items-center justify-between text-sm text-zinc-600">
            <span>
              {meta.total} kayıt — Sayfa {meta.page}/{meta.totalPages}
            </span>
            <div className="flex gap-2">
              <button
                disabled={meta.page <= 1}
                onClick={() => setFilter((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
                className="px-3 py-1 rounded border border-zinc-200 hover:bg-zinc-50 disabled:opacity-40"
              >
                Önceki
              </button>
              <button
                disabled={meta.page >= meta.totalPages}
                onClick={() => setFilter((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
                className="px-3 py-1 rounded border border-zinc-200 hover:bg-zinc-50 disabled:opacity-40"
              >
                Sonraki
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

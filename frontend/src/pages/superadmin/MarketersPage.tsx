import { useState, useMemo } from 'react';
import { Search, Megaphone, RefreshCw, Power, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  useSuperAdminMarketers,
  useSuperAdminMarketer,
  useUpdateMarketerStatus,
  useRegenerateMarketerReferralCode,
} from '../../features/superadmin/api/superAdminApi';
import type { SuperAdminMarketerFilter } from '../../features/superadmin/api/superAdminApi';

const ROLE_BADGE: Record<string, string> = {
  SALES_MANAGER: 'bg-purple-100 text-purple-800',
  SALES_REP: 'bg-blue-100 text-blue-800',
};

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  INACTIVE: 'bg-zinc-200 text-zinc-700',
};

export default function MarketersPage() {
  const [filter, setFilter] = useState<SuperAdminMarketerFilter>({
    page: 1,
    limit: 20,
  });
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const effectiveFilter = useMemo(
    () => ({
      ...filter,
      search: search.trim() || undefined,
    }),
    [filter, search],
  );

  const { data, isLoading } = useSuperAdminMarketers(effectiveFilter);
  const updateStatus = useUpdateMarketerStatus();
  const regenerate = useRegenerateMarketerReferralCode();

  const rows = data?.data ?? [];
  const meta = data?.meta;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Megaphone className="w-6 h-6 text-zinc-700" />
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Pazarlamacılar</h1>
          <p className="text-sm text-zinc-500">
            Platform genelinde tüm pazarlamacılar ve komisyon performansları.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2 relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ad, e-posta veya ref kod ara..."
              className="w-full pl-9 pr-3 py-2 border border-zinc-300 rounded-lg text-sm focus:ring-2 focus:ring-zinc-900 focus:border-zinc-900 outline-none"
            />
          </div>
          <div>
            <select
              value={filter.role ?? ''}
              onChange={(e) =>
                setFilter((f) => ({
                  ...f,
                  page: 1,
                  role: (e.target.value || undefined) as any,
                }))
              }
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm"
            >
              <option value="">Tüm roller</option>
              <option value="SALES_MANAGER">SALES_MANAGER</option>
              <option value="SALES_REP">SALES_REP</option>
            </select>
          </div>
          <div>
            <select
              value={filter.status ?? ''}
              onChange={(e) =>
                setFilter((f) => ({
                  ...f,
                  page: 1,
                  status: (e.target.value || undefined) as any,
                }))
              }
              className="w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm"
            >
              <option value="">Tüm durumlar</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="INACTIVE">INACTIVE</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-zinc-50 text-left text-zinc-500 text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Ad</th>
                <th className="px-4 py-3 font-medium">E-posta</th>
                <th className="px-4 py-3 font-medium">Rol</th>
                <th className="px-4 py-3 font-medium">Ref kod</th>
                <th className="px-4 py-3 font-medium text-right">Lead</th>
                <th className="px-4 py-3 font-medium text-right">Kazanılan</th>
                <th className="px-4 py-3 font-medium text-right">Komisyon</th>
                <th className="px-4 py-3 font-medium">Durum</th>
                <th className="px-4 py-3 font-medium">Aksiyon</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {isLoading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-zinc-500">
                    Yükleniyor...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-zinc-500">
                    Hiç pazarlamacı bulunamadı
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-zinc-50 cursor-pointer"
                    onClick={() => setSelectedId(r.id)}
                  >
                    <td className="px-4 py-3 font-medium text-zinc-900">
                      {r.firstName} {r.lastName}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{r.email}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[r.role] ?? 'bg-zinc-100'}`}
                      >
                        {r.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-zinc-700">
                      {r.referralCode ?? <span className="text-zinc-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.totalLeads}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700 font-medium">
                      {r.wonLeads}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      ₺{Number(r.lifetimeCommissionAmount).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[r.status] ?? 'bg-zinc-100'}`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => {
                            const next = r.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
                            updateStatus.mutate(
                              { id: r.id, status: next },
                              {
                                onSuccess: () =>
                                  toast.success(
                                    next === 'ACTIVE'
                                      ? 'Pazarlamacı aktifleştirildi'
                                      : 'Pazarlamacı pasifleştirildi',
                                  ),
                                onError: () => toast.error('Durum güncellenemedi'),
                              },
                            );
                          }}
                          className="px-2 py-1 text-xs text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded inline-flex items-center gap-1"
                          title={r.status === 'ACTIVE' ? 'Pasifleştir' : 'Aktifleştir'}
                        >
                          <Power className="w-3 h-3" />
                          {r.status === 'ACTIVE' ? 'Pasifleştir' : 'Aktifleştir'}
                        </button>
                        <button
                          onClick={() => {
                            if (
                              window.confirm(
                                'Eski ref kodu çalışmayacak ve paylaşılmış linkler kırılacak. Devam edilsin mi?',
                              )
                            ) {
                              regenerate.mutate(r.id, {
                                onSuccess: (res: any) =>
                                  toast.success(`Yeni kod: ${res?.referralCode}`),
                                onError: () => toast.error('Kod yenilenemedi'),
                              });
                            }
                          }}
                          className="px-2 py-1 text-xs text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded inline-flex items-center gap-1"
                          title="Ref kodunu yenile"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Kodu yenile
                        </button>
                      </div>
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

      {selectedId && (
        <MarketerDrawer id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

function MarketerDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading } = useSuperAdminMarketer(id);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-zinc-900/30" onClick={onClose}>
      <div
        className="w-full max-w-lg h-full bg-white shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sticky top-0 bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">Pazarlamacı Detayı</h2>
          <button onClick={onClose} className="p-1 text-zinc-400 hover:text-zinc-700">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="px-6 py-5 space-y-6">
          {isLoading || !data ? (
            <div className="h-40 animate-pulse rounded-lg bg-zinc-100" />
          ) : (
            <>
              <section>
                <div className="text-sm text-zinc-500">İletişim</div>
                <div className="mt-1 text-base font-semibold text-zinc-900">
                  {data.firstName} {data.lastName}
                </div>
                <div className="text-sm text-zinc-600">{data.email}</div>
                {data.phone && <div className="text-sm text-zinc-600">{data.phone}</div>}
                {data.referralCode && (
                  <div className="mt-2 inline-flex items-center gap-2 rounded-md bg-zinc-100 px-2 py-1 font-mono text-sm text-zinc-800">
                    Ref kod: {data.referralCode}
                  </div>
                )}
              </section>

              <section>
                <h3 className="text-sm font-semibold text-zinc-900 mb-2">Komisyon Özeti</h3>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  {(['PENDING', 'APPROVED', 'PAID'] as const).map((status) => {
                    const t = data.commissionTotals?.[status];
                    return (
                      <div key={status} className="rounded-md bg-zinc-50 p-3">
                        <div className="text-xs text-zinc-500">{status}</div>
                        <div className="mt-0.5 font-semibold text-zinc-900">
                          ₺{Number(t?.amount ?? 0).toFixed(2)}
                        </div>
                        <div className="text-xs text-zinc-400">{t?.count ?? 0} kayıt</div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-zinc-900 mb-2">
                  Son Lead'ler (10)
                </h3>
                <ul className="divide-y divide-zinc-100 border border-zinc-100 rounded-md">
                  {data.recentLeads?.length ? (
                    data.recentLeads.map((l: any) => (
                      <li key={l.id} className="px-3 py-2 text-sm flex justify-between">
                        <span className="text-zinc-900">{l.businessName}</span>
                        <span className="text-zinc-500 text-xs">
                          {l.status} · {l.source}
                        </span>
                      </li>
                    ))
                  ) : (
                    <li className="px-3 py-3 text-sm text-zinc-400">Henüz lead yok</li>
                  )}
                </ul>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-zinc-900 mb-2">
                  Son Komisyonlar (10)
                </h3>
                <ul className="divide-y divide-zinc-100 border border-zinc-100 rounded-md">
                  {data.recentCommissions?.length ? (
                    data.recentCommissions.map((c: any) => (
                      <li key={c.id} className="px-3 py-2 text-sm flex justify-between">
                        <span className="text-zinc-900">
                          {c.type} · {c.period}
                          {c.tenant?.name && (
                            <span className="ml-2 text-xs text-zinc-500">
                              {c.tenant.name}
                            </span>
                          )}
                        </span>
                        <span className="font-medium tabular-nums">
                          ₺{Number(c.amount).toFixed(2)}{' '}
                          <span className="text-xs text-zinc-400">{c.status}</span>
                        </span>
                      </li>
                    ))
                  ) : (
                    <li className="px-3 py-3 text-sm text-zinc-400">Henüz komisyon yok</li>
                  )}
                </ul>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

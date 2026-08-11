import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Modal from '../../components/ui/Modal';
import {
  ADDON_BILLINGS,
  ADDON_KINDS,
  CATALOG_LOCALES,
  CREDIT_KINDS,
  type AdminAddOn,
  type AdminHardwareProduct,
  useSaArchiveAddOn,
  useSaArchiveProduct,
  useSaCreateAddOn,
  useSaCreateProduct,
  useSaListAddOns,
  useSaListProducts,
  useSaReceiveStock,
  useSaUpdateAddOn,
  useSaUpdateProduct,
} from '../../features/superadmin/api/superadminMarketplaceApi';

/**
 * SuperAdmin marketplace management.
 *
 * Two stacked tables in one page — add-ons (top), hardware products (bottom)
 * — because the operational flow is "publish a new SKU + a matching add-on
 * code" and splitting them across two pages costs more clicks than it earns
 * in screen real estate. Forms are inline modals to keep the page itself
 * scannable.
 *
 * Edits use the JSON grants/compat blobs raw — these are admin tools, not
 * tenant tools, so a JSON editor is faster than a Pretty UI for the people
 * who actually touch them.
 */
export default function MarketplaceAdminPage() {
  const { t: tr } = useTranslation('superadmin');
  const [tab, setTab] = useState<'addons' | 'products'>('addons');
  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{tr('marketplace.title')}</h1>
        <nav className="flex gap-1">
          {(['addons', 'products'] as const).map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setTab(tabKey)}
              className={`rounded-full px-3 py-1 text-sm ${
                tab === tabKey ? 'bg-gray-900 text-white' : 'border bg-white hover:bg-gray-50'
              }`}
            >
              {tabKey === 'addons' ? tr('marketplace.tabAddons') : tr('marketplace.tabHardware')}
            </button>
          ))}
        </nav>
      </header>

      {tab === 'addons' ? <AddOnsSection /> : <ProductsSection />}
    </div>
  );
}

// ── Add-ons ────────────────────────────────────────────────────────────

function AddOnsSection() {
  const { t: tr } = useTranslation('superadmin');
  const { data: addons = [], isLoading } = useSaListAddOns();
  const create = useSaCreateAddOn();
  const update = useSaUpdateAddOn();
  const archive = useSaArchiveAddOn();
  const [editing, setEditing] = useState<AdminAddOn | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{tr('marketplace.addons.catalogue')}</h2>
        <button
          onClick={() => setCreating(true)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          {tr('marketplace.addons.new')}
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">{tr('marketplace.loading')}</div>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full divide-y rounded border text-sm min-w-[640px]">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">{tr('marketplace.addons.col.code')}</th>
              <th className="px-3 py-2 font-medium">{tr('marketplace.addons.col.name')}</th>
              <th className="px-3 py-2 font-medium">{tr('marketplace.addons.col.kind')}</th>
              <th className="px-3 py-2 font-medium">{tr('marketplace.addons.col.billing')}</th>
              <th className="px-3 py-2 font-medium">{tr('marketplace.addons.col.licence')}</th>
              <th className="px-3 py-2 font-medium">{tr('marketplace.addons.col.price')}</th>
              <th className="px-3 py-2 font-medium">{tr('marketplace.addons.col.status')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {addons.map((a) => (
              <tr key={a.id}>
                <td className="px-3 py-2 font-mono text-xs">{a.code}</td>
                <td className="px-3 py-2">{a.name}</td>
                <td className="px-3 py-2 text-xs">{a.kind}</td>
                <td className="px-3 py-2 text-xs">{a.billing}</td>
                <td className="px-3 py-2 text-xs">
                  {a.requiresLicense ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                      {tr('marketplace.addons.needsLicence')}
                    </span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {(a.priceCents / 100).toLocaleString('tr-TR', { style: 'currency', currency: a.currency })}
                  {a.creditKind && (
                    <div className="text-xs font-normal text-gray-500">
                      {a.creditUnits} × {a.creditKind}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <StatusPill status={a.status} />
                </td>
                <td className="space-x-2 px-3 py-2 text-right text-xs">
                  <button onClick={() => setEditing(a)} className="text-blue-600 hover:underline">
                    {tr('marketplace.addons.edit')}
                  </button>
                  {a.status !== 'published' && (
                    <button
                      onClick={() => update.mutate({ id: a.id, status: 'published' })}
                      className="text-green-700 hover:underline"
                    >
                      {tr('marketplace.addons.publish')}
                    </button>
                  )}
                  {a.status !== 'archived' && (
                    <button
                      onClick={() => {
                        if (confirm(tr('marketplace.addons.confirmArchive', { code: a.code }))) archive.mutate(a.id);
                      }}
                      className="text-red-600 hover:underline"
                    >
                      {tr('marketplace.addons.archive')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {(creating || editing) && (
        <AddOnEditorModal
          initial={editing ?? undefined}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSubmit={async (body) => {
            // F5: only close on success. The mutation hooks toast the error;
            // catching here keeps the modal (and the operator's input) open
            // instead of surfacing an unhandled rejection and losing the edit.
            try {
              if (editing) await update.mutateAsync({ id: editing.id, ...body });
              else await create.mutateAsync(body);
              setEditing(null);
              setCreating(false);
            } catch {
              // Error toast already shown by the hook's onError.
            }
          }}
        />
      )}
    </section>
  );
}

interface AddOnEditorProps {
  initial?: AdminAddOn;
  onSubmit: (body: Partial<AdminAddOn>) => Promise<void>;
  onClose: () => void;
}

function AddOnEditorModal({ initial, onSubmit, onClose }: AddOnEditorProps) {
  const { t: tr } = useTranslation('superadmin');
  const [form, setForm] = useState({
    code: initial?.code ?? '',
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    kind: initial?.kind ?? 'module',
    billing: initial?.billing ?? 'annual',
    priceCents: initial?.priceCents ?? 0,
    currency: initial?.currency ?? 'TRY',
    grantsJson: JSON.stringify(initial?.grants ?? {}, null, 2),
    depsCsv: (initial?.deps ?? []).join(','),
    status: initial?.status ?? 'draft',
    // Defaults to true, matching the backend column: the safe answer for a new
    // product is "needs a licence", because the alternative hands capability to
    // tenants who have bought nothing.
    requiresLicense: initial?.requiresLicense ?? true,
    creditKind: initial?.creditKind ?? '',
    creditUnits: initial?.creditUnits ?? '',
    maxQuantity: initial?.maxQuantity ?? '',
    sortOrder: initial?.sortOrder ?? 0,
    i18n: initial?.i18n ?? {},
  });
  const [error, setError] = useState<string | null>(null);

  const isCredit = form.kind === 'credit';
  const isLicence = form.kind === 'license';

  function patchI18n(locale: string, field: 'name' | 'description', value: string) {
    setForm((f) => ({
      ...f,
      i18n: { ...f.i18n, [locale]: { ...(f.i18n[locale] ?? {}), [field]: value } },
    }));
  }

  async function submit() {
    setError(null);
    let grants: Record<string, unknown>;
    try {
      grants = JSON.parse(form.grantsJson);
    } catch {
      setError(tr('marketplace.addons.grantsInvalid'));
      return;
    }

    // Mirror the server-side invariants (catalog-validation.ts) so a bad row
    // fails here with a readable message instead of a round-trip 400. The
    // server still checks: this is a convenience, not the gate.
    if (isCredit && (!form.creditKind || !Number(form.creditUnits))) {
      setError(tr('marketplace.addons.creditIncomplete'));
      return;
    }
    if (form.status === 'published' && Number(form.priceCents) <= 0) {
      setError(tr('marketplace.addons.publishedNeedsPrice'));
      return;
    }
    if (isLicence && form.requiresLicense) {
      setError(tr('marketplace.addons.licenceSelfRequire'));
      return;
    }
    if (form.depsCsv.includes('plan:')) {
      setError(tr('marketplace.addons.planDepsGone'));
      return;
    }

    const body: Partial<AdminAddOn> = {
      ...(initial ? {} : { code: form.code }),
      name: form.name,
      description: form.description || undefined,
      kind: form.kind as AdminAddOn['kind'],
      billing: form.billing as AdminAddOn['billing'],
      priceCents: Number(form.priceCents) || 0,
      currency: form.currency,
      grants,
      deps: form.depsCsv.split(',').map((s) => s.trim()).filter(Boolean),
      status: form.status as AdminAddOn['status'],
      requiresLicense: form.requiresLicense,
      creditKind: isCredit ? (form.creditKind as AdminAddOn['creditKind']) : null,
      creditUnits: isCredit ? Number(form.creditUnits) : null,
      maxQuantity: form.maxQuantity === '' ? null : Number(form.maxQuantity),
      sortOrder: Number(form.sortOrder) || 0,
      i18n: Object.keys(form.i18n).length ? form.i18n : null,
    };
    await onSubmit(body);
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={initial ? tr('marketplace.addons.editTitle') : tr('marketplace.addons.newTitle')}
      size="xl"
    >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={tr('marketplace.addons.fields.code')}>
            <input
              className="rounded border px-2 py-1 text-sm font-mono w-full"
              disabled={!!initial}
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="module_personnel"
            />
          </Field>
          <Field label={tr('marketplace.addons.fields.name')}>
            <input className="rounded border px-2 py-1 text-sm w-full" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label={tr('marketplace.addons.fields.kind')}>
            <select
              className="rounded border px-2 py-1 text-sm w-full"
              value={form.kind}
              onChange={(e) => {
                const kind = e.target.value as AdminAddOn['kind'];
                setForm((f) => ({
                  ...f,
                  kind,
                  // A credit pack is a one-time balance; the licence never
                  // requires itself. Steering these here stops the two
                  // combinations the server rejects from being reachable.
                  billing: kind === 'credit' || kind === 'service' ? 'oneTime' : 'annual',
                  requiresLicense: kind === 'license' ? false : f.requiresLicense,
                }));
              }}
            >
              {ADDON_KINDS.map((kind) => (
                <option key={kind} value={kind}>{kind}</option>
              ))}
            </select>
          </Field>
          <Field label={tr('marketplace.addons.fields.billing')}>
            <select className="rounded border px-2 py-1 text-sm w-full" value={form.billing} onChange={(e) => setForm((f) => ({ ...f, billing: e.target.value as AdminAddOn['billing'] }))}>
              {ADDON_BILLINGS.map((billing) => (
                <option key={billing} value={billing}>{billing}</option>
              ))}
            </select>
          </Field>
          <Field label={tr('marketplace.addons.fields.priceCents')}>
            <input className="rounded border px-2 py-1 text-sm w-full tabular-nums" type="number" value={form.priceCents} onChange={(e) => setForm((f) => ({ ...f, priceCents: Number(e.target.value) }))} />
            <span className="mt-0.5 block text-[11px] text-gray-500">
              {(Number(form.priceCents) / 100).toLocaleString('tr-TR', { style: 'currency', currency: form.currency || 'TRY' })}
              {form.billing === 'annual' && ` ${tr('marketplace.addons.perYear')}`}
            </span>
          </Field>
          <Field label={tr('marketplace.addons.fields.currency')}>
            <input className="rounded border px-2 py-1 text-sm w-full" value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} />
          </Field>
          <Field label={tr('marketplace.addons.fields.status')}>
            <select className="rounded border px-2 py-1 text-sm w-full" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as AdminAddOn['status'] }))}>
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="archived">archived</option>
            </select>
          </Field>
          <Field label={tr('marketplace.addons.fields.sortOrder')}>
            <input className="rounded border px-2 py-1 text-sm w-full tabular-nums" type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))} />
          </Field>
          <Field label={tr('marketplace.addons.fields.deps')}>
            <input className="rounded border px-2 py-1 text-sm w-full" value={form.depsCsv} onChange={(e) => setForm((f) => ({ ...f, depsCsv: e.target.value }))} placeholder="license_annual, module_inventory" />
          </Field>
          <Field label={tr('marketplace.addons.fields.maxQuantity')}>
            <input className="rounded border px-2 py-1 text-sm w-full tabular-nums" type="number" min={1} value={form.maxQuantity} onChange={(e) => setForm((f) => ({ ...f, maxQuantity: e.target.value }))} placeholder="∞" />
          </Field>
        </div>

        <label className="mt-3 flex items-start gap-2 text-xs text-gray-700">
          <input
            type="checkbox"
            className="mt-0.5"
            disabled={isLicence}
            checked={form.requiresLicense}
            onChange={(e) => setForm((f) => ({ ...f, requiresLicense: e.target.checked }))}
          />
          <span>
            <span className="font-medium">{tr('marketplace.addons.fields.requiresLicense')}</span>
            <span className="block text-gray-500">{tr('marketplace.addons.requiresLicenseHint')}</span>
          </span>
        </label>

        {isCredit && (
          <div className="mt-3 grid grid-cols-1 gap-3 rounded border border-dashed p-3 sm:grid-cols-2">
            <Field label={tr('marketplace.addons.fields.creditKind')}>
              <select className="rounded border px-2 py-1 text-sm w-full" value={form.creditKind} onChange={(e) => setForm((f) => ({ ...f, creditKind: e.target.value }))}>
                <option value="">—</option>
                {CREDIT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{kind}</option>
                ))}
              </select>
            </Field>
            <Field label={tr('marketplace.addons.fields.creditUnits')}>
              <input className="rounded border px-2 py-1 text-sm w-full tabular-nums" type="number" min={1} value={form.creditUnits} onChange={(e) => setForm((f) => ({ ...f, creditUnits: e.target.value }))} />
            </Field>
          </div>
        )}

        <Field label={tr('marketplace.addons.fields.description')}>
          <textarea
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
            rows={2}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </Field>

        {/* Localized copy lives in the DB, so a new product or a reworded one
            ships without a frontend release. Blank locales fall back to the
            base name/description at read time. */}
        <details className="mt-3 rounded border p-2">
          <summary className="cursor-pointer text-xs font-medium text-gray-700">
            {tr('marketplace.addons.i18nTitle')}
          </summary>
          <div className="mt-2 space-y-2">
            {CATALOG_LOCALES.map((locale) => (
              <div key={locale} className="grid grid-cols-1 gap-2 sm:grid-cols-[3rem_1fr_1fr] sm:items-center">
                <span className="font-mono text-xs uppercase text-gray-500">{locale}</span>
                <input
                  className="rounded border px-2 py-1 text-sm"
                  placeholder={tr('marketplace.addons.fields.name')}
                  value={form.i18n[locale]?.name ?? ''}
                  onChange={(e) => patchI18n(locale, 'name', e.target.value)}
                />
                <input
                  className="rounded border px-2 py-1 text-sm"
                  placeholder={tr('marketplace.addons.fields.description')}
                  value={form.i18n[locale]?.description ?? ''}
                  onChange={(e) => patchI18n(locale, 'description', e.target.value)}
                />
              </div>
            ))}
          </div>
        </details>

        <Field label={tr('marketplace.addons.fields.grants')}>
          <textarea
            className="mt-1 w-full rounded border px-2 py-1 font-mono text-xs"
            rows={6}
            value={form.grantsJson}
            onChange={(e) => setForm((f) => ({ ...f, grantsJson: e.target.value }))}
          />
          <span className="mt-0.5 block text-[11px] text-gray-500">
            {tr('marketplace.addons.grantsHint')}
          </span>
        </Field>

        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded border px-3 py-1.5 text-sm">{tr('marketplace.cancel')}</button>
          <button onClick={submit} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">
            {initial ? tr('marketplace.addons.save') : tr('marketplace.addons.create')}
          </button>
        </div>
    </Modal>
  );
}


// ── Hardware products ──────────────────────────────────────────────────

function ProductsSection() {
  const { t: tr } = useTranslation('superadmin');
  const { data: products = [], isLoading } = useSaListProducts();
  const update = useSaUpdateProduct();
  const archive = useSaArchiveProduct();
  const stock = useSaReceiveStock();
  const create = useSaCreateProduct();
  const [creating, setCreating] = useState(false);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">{tr('marketplace.products.catalogue')}</h2>
        <button
          onClick={() => setCreating(true)}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
        >
          {tr('marketplace.products.new')}
        </button>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-500">{tr('marketplace.loading')}</div>
      ) : (
        <div className="overflow-x-auto">
        <table className="w-full divide-y rounded border text-sm min-w-[640px]">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">{tr('marketplace.products.col.sku')}</th>
              <th className="px-3 py-2 font-medium">{tr('marketplace.products.col.name')}</th>
              <th className="px-3 py-2 font-medium">{tr('marketplace.products.col.category')}</th>
              <th className="px-3 py-2 font-medium">{tr('marketplace.products.col.price')}</th>
              <th className="px-3 py-2 font-medium">{tr('marketplace.products.col.available')}</th>
              <th className="px-3 py-2 font-medium">{tr('marketplace.products.col.status')}</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {products.map((p: AdminHardwareProduct) => (
              <tr key={p.id}>
                <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-2 text-xs">{p.category}</td>
                <td className="px-3 py-2 tabular-nums">
                  {(p.priceCents / 100).toLocaleString('tr-TR', { style: 'currency', currency: p.currency })}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {p.inventory?.available ?? 0}
                  {(p.inventory?.allocated ?? 0) > 0 && (
                    <span className="ml-1 text-xs text-gray-500">{tr('marketplace.products.allocated', { count: p.inventory!.allocated })}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <StatusPill status={p.status} />
                </td>
                <td className="space-x-2 px-3 py-2 text-right text-xs">
                  <button
                    onClick={() => {
                      const qty = prompt(tr('marketplace.products.promptReceiveUnits'));
                      const n = Number(qty);
                      if (!Number.isFinite(n) || n < 1) return;
                      stock.mutate({ id: p.id, qty: n });
                    }}
                    className="text-blue-600 hover:underline"
                  >
                    {tr('marketplace.products.receiveStock')}
                  </button>
                  {p.status !== 'published' && (
                    <button
                      onClick={() => update.mutate({ id: p.id, status: 'published' })}
                      className="text-green-700 hover:underline"
                    >
                      {tr('marketplace.products.publish')}
                    </button>
                  )}
                  {p.status !== 'archived' && (
                    <button
                      onClick={() => {
                        if (confirm(tr('marketplace.products.confirmArchive', { sku: p.sku }))) archive.mutate(p.id);
                      }}
                      className="text-red-600 hover:underline"
                    >
                      {tr('marketplace.products.archive')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {creating && (
        <ProductEditorModal
          onClose={() => setCreating(false)}
          onSubmit={async (body) => {
            // F5: keep the modal open on failure (hook onError toasts).
            try {
              await create.mutateAsync(body);
              setCreating(false);
            } catch {
              // Error toast already shown by the hook's onError.
            }
          }}
        />
      )}
    </section>
  );
}

interface ProductEditorProps {
  onSubmit: (body: Partial<AdminHardwareProduct>) => Promise<void>;
  onClose: () => void;
}

function ProductEditorModal({ onSubmit, onClose }: ProductEditorProps) {
  const { t: tr } = useTranslation('superadmin');
  const [form, setForm] = useState({
    sku: '',
    category: 'kds_screen',
    name: '',
    brand: '',
    model: '',
    description: '',
    priceCents: 0,
    rentalMonthlyCents: '' as string | number,
    currency: 'TRY',
    warrantyMonths: 24,
    status: 'draft',
  });

  async function submit() {
    await onSubmit({
      sku: form.sku,
      category: form.category,
      name: form.name,
      brand: form.brand || null,
      model: form.model || null,
      description: form.description || null,
      priceCents: Number(form.priceCents) || 0,
      rentalMonthlyCents: form.rentalMonthlyCents === '' ? null : Number(form.rentalMonthlyCents),
      currency: form.currency,
      warrantyMonths: Number(form.warrantyMonths) || 0,
      status: form.status as AdminHardwareProduct['status'],
    });
  }

  return (
    <Modal isOpen onClose={onClose} title={tr('marketplace.products.newTitle')} size="xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={tr('marketplace.products.fields.sku')}><input className="rounded border px-2 py-1 text-sm font-mono w-full" value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} /></Field>
          <Field label={tr('marketplace.products.fields.name')}><input className="rounded border px-2 py-1 text-sm w-full" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
          <Field label={tr('marketplace.products.fields.category')}>
            <select className="rounded border px-2 py-1 text-sm w-full" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              <option value="kds_screen">kds_screen</option>
              <option value="tablet">tablet</option>
              <option value="pos_terminal">pos_terminal</option>
              <option value="printer">printer</option>
              <option value="yazarkasa">yazarkasa</option>
              <option value="bridge">bridge</option>
              <option value="scanner">scanner</option>
              <option value="caller_id">caller_id</option>
              <option value="other">other</option>
            </select>
          </Field>
          <Field label={tr('marketplace.products.fields.brand')}><input className="rounded border px-2 py-1 text-sm w-full" value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} /></Field>
          <Field label={tr('marketplace.products.fields.model')}><input className="rounded border px-2 py-1 text-sm w-full" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} /></Field>
          <Field label={tr('marketplace.products.fields.priceCents')}><input className="rounded border px-2 py-1 text-sm w-full tabular-nums" type="number" value={form.priceCents} onChange={(e) => setForm((f) => ({ ...f, priceCents: Number(e.target.value) }))} /></Field>
          <Field label={tr('marketplace.products.fields.rentalMonthly')}><input className="rounded border px-2 py-1 text-sm w-full tabular-nums" type="number" value={form.rentalMonthlyCents} onChange={(e) => setForm((f) => ({ ...f, rentalMonthlyCents: e.target.value }))} /></Field>
          <Field label={tr('marketplace.products.fields.currency')}><input className="rounded border px-2 py-1 text-sm w-full" value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))} /></Field>
          <Field label={tr('marketplace.products.fields.warrantyMonths')}><input className="rounded border px-2 py-1 text-sm w-full tabular-nums" type="number" value={form.warrantyMonths} onChange={(e) => setForm((f) => ({ ...f, warrantyMonths: Number(e.target.value) }))} /></Field>
          <Field label={tr('marketplace.products.fields.status')}>
            <select className="rounded border px-2 py-1 text-sm w-full" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="draft">draft</option>
              <option value="published">published</option>
            </select>
          </Field>
        </div>
        <Field label={tr('marketplace.products.fields.description')}>
          <textarea className="mt-1 w-full rounded border px-2 py-1 text-sm" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded border px-3 py-1.5 text-sm">{tr('marketplace.products.cancel')}</button>
          <button onClick={submit} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white">{tr('marketplace.products.create')}</button>
        </div>
    </Modal>
  );
}

// ── Shared bits ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col text-xs text-gray-600">
      <span>{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    published: 'bg-green-100 text-green-800',
    archived: 'bg-red-100 text-red-800',
  };
  return (
    <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-gray-100'}`}>
      {status}
    </span>
  );
}

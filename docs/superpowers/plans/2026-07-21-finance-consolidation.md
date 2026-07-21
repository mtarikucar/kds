# Finans Konsolidasyonu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sidebar'daki 3 para girişini (+2 gizli rota) tek "Finans" çatısına indirmek, tüm donanımı şube hub'ında birleştirmek, rapor sekmelerini tematik gruplamak ve jargonu mekan-sahibi diline çevirmek — tamamı frontend-only.

**Architecture:** Grup-anahtarı + `embedded`-prop konsolidasyon deseni (emsal: `ReportsAnalyticsPage`, `StockPage`). Yeni `FinancePage` sarmalayıcısı mevcut `CashPage`/`AccountingBackOfficePage`'i gömer; eski rotalar `<Navigate replace>` ile yönlenir; gate'ler "hide-not-403" kuralıyla sekme düzeyine iner. Spec: `docs/superpowers/specs/2026-07-21-finance-consolidation-design.md`.

**Tech Stack:** React 18 + TS + Vite, react-router v6, @tanstack/react-query, i18next (5 locale: ar/en/ru/tr/uz), vitest + @testing-library/react, lucide-react.

## Global Constraints

- **Commit kuralı (SERT):** commit/PR mesajlarına HİÇBİR Claude/AI izi eklenmez (`Co-Authored-By: Claude`, `🤖 Generated with…` YASAK). Düz conventional commit; author `tarik <56091479+mtarikucar@users.noreply.github.com>`.
- **Branch:** tüm işler `feat/finance-consolidation` üstünde, görev-başına-commit. Ana checkout'ta PARALEL BİR OTURUM AKTİF — işler ayrı worktree'de yapılır (Task 0).
- **i18n:** her yeni/değişen anahtar AYNI commit'te 5 locale'e (ar/en/ru/tr/uz) yazılır; referans locale `en`. Doğrulama: `node scripts/check-i18n-parity.mjs` (repo kökünden).
- **Yeni route** her zaman `lazyWithReload` ile (SPA stale-chunk kuralı).
- **Gating:** hide-not-403 — erişilemeyen sekme/kart render edilmez; 403'e çarpan görünür UI bırakılmaz. Tek istisna: yazarkasa upsell kartı (Task 3).
- **Backend'e dokunulmaz.** Kaldırılan FE gate'leri backend gerçeğiyle zaten hizalı (`sales-invoices` ve `z-reports` controller'ları plan-gate'siz).
- **Push:** `git push` TAI ağında ÇALIŞMAZ — `scripts/push-via-openssl.sh` kullan; PR işlemleri `gh` ile.
- Frontend komutları `frontend/` içinden: test `npm run test:ci -- <path>`, tip `npx tsc --noEmit`, lint `npm run lint`.

---

### Task 0: Worktree kurulumu

**Files:** (dosya değişikliği yok)

- [ ] **Step 1: Worktree aç**

```bash
cd /home/tarik/Projects/kds
git worktree add ../kds-finance feat/finance-consolidation
cd ../kds-finance/frontend && npm ci
```
Expected: worktree `/home/tarik/Projects/kds-finance`, `npm ci` hatasız. Bundan sonraki TÜM görevler bu worktree'de çalışır.

- [ ] **Step 2: Taban durumu doğrula**

```bash
cd /home/tarik/Projects/kds-finance/frontend && npx tsc --noEmit
```
Expected: 0 hata (taban temiz; değilse DUR ve raporla — taban `feat/dashboard-redesign` üstüne stack'li, oradaki kırık bize taşınmasın).

---

### Task 1: FinancePage iskeleti + sidebar + redirect seti (Faz 1a)

**Files:**
- Create: `frontend/src/pages/admin/FinancePage.tsx`
- Modify: `frontend/src/App.tsx` (lazy def ~satır 143-153 bölgesi; rotalar ~496, 497-507, 543, 801-811)
- Modify: `frontend/src/components/layout/Sidebar.tsx` (~satır 62-76 arası Operasyon öğeleri; ~256-262 Fiş Kurtarma)
- Modify: `frontend/src/pages/admin/CashPage.tsx` (embedded prop)
- Modify: `frontend/src/pages/admin/AccountingBackOfficePage.tsx` (embedded + tab query-param)
- Modify: `frontend/src/i18n/locales/{ar,en,ru,tr,uz}/common.json` (`navigation.finance`, `finance.groups.*`)
- Test: `frontend/src/pages/admin/__tests__/FinancePage.groups.test.tsx`

**Interfaces:**
- Produces: `FinancePage` (default export) — `?group=cash|documents` query-param'ını okur; `CashPage({ embedded?: boolean })`; `AccountingBackOfficePage({ embedded?: boolean })` + `?tab=invoices|edoc|settings` init. Task 2-5 bunların üstüne kurulur.

- [ ] **Step 1: Failing test yaz**

```tsx
// frontend/src/pages/admin/__tests__/FinancePage.groups.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FinancePage from '../FinancePage';

vi.mock('../CashPage', () => ({ default: () => <div>KASA-PANEL</div> }));
vi.mock('../AccountingBackOfficePage', () => ({ default: () => <div>BELGE-PANEL</div> }));

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <FinancePage />
    </MemoryRouter>,
  );

describe('FinancePage — grup anahtarı', () => {
  it('varsayılan grup Kasa; Belgeler pill ile geçilir', () => {
    renderAt('/admin/finance');
    expect(screen.getByText('KASA-PANEL')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Documents|Belgeler/ }));
    expect(screen.getByText('BELGE-PANEL')).toBeTruthy();
  });

  it('?group=documents ile Belgeler açılır', () => {
    renderAt('/admin/finance?group=documents');
    expect(screen.getByText('BELGE-PANEL')).toBeTruthy();
  });

  it('geçersiz group paramı Kasa\'ya düşer', () => {
    renderAt('/admin/finance?group=zzz');
    expect(screen.getByText('KASA-PANEL')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Testi çalıştır, FAIL gör**

Run: `npm run test:ci -- src/pages/admin/__tests__/FinancePage.groups.test.tsx`
Expected: FAIL — "Cannot find module '../FinancePage'".

- [ ] **Step 3: FinancePage'i yaz**

```tsx
// frontend/src/pages/admin/FinancePage.tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Wallet, Receipt } from 'lucide-react';
import { cn } from '../../lib/utils';
import CashPage from './CashPage';
import AccountingBackOfficePage from './AccountingBackOfficePage';

/**
 * Finans — tek çatı: Kasa (eski Nakit & ÖKC) + Belgeler (eski Muhasebe +
 * Fiş Kurtarma). Eski rotalar (/admin/cash, /admin/accounting-backoffice,
 * /admin/invoices, /admin/fiscal-recovery) App.tsx'te buraya redirect eder.
 * Desen: grup anahtarı + embedded prop (bkz. ReportsAnalyticsPage, StockPage).
 * Gate yok: kasa/vardiya + fatura kesme yasal çekirdek — her planda açık.
 */
type Group = 'cash' | 'documents';
const VALID_GROUPS: readonly Group[] = ['cash', 'documents'];

const FinancePage = () => {
  const { t } = useTranslation('common');
  const [searchParams] = useSearchParams();
  const requested = searchParams.get('group');
  const [group, setGroup] = useState<Group>(
    VALID_GROUPS.includes(requested as Group) ? (requested as Group) : 'cash',
  );

  const groups = [
    { id: 'cash' as const, label: t('finance.groups.cash', 'Kasa'), icon: Wallet },
    { id: 'documents' as const, label: t('finance.groups.documents', 'Belgeler'), icon: Receipt },
  ];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-heading font-bold text-slate-900">
          {t('navigation.finance', 'Finans')}
        </h1>
      </div>

      <div className="inline-flex rounded-xl bg-slate-100 p-1">
        {groups.map((g) => {
          const Icon = g.icon;
          return (
            <button
              key={g.id}
              onClick={() => setGroup(g.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
                group === g.id
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <Icon className="h-4 w-4" />
              {g.label}
            </button>
          );
        })}
      </div>

      {group === 'cash' && <CashPage embedded />}
      {group === 'documents' && <AccountingBackOfficePage embedded />}
    </div>
  );
};

export default FinancePage;
```
NOT (padding): `CashPage`/`AccountingBackOfficePage` kendi `p-4 sm:p-6`'sını taşıyor, `ReportsAnalyticsPage` taşımıyor — Layout'un pad edip etmediği rota bazında farklı. FinancePage köküne `p-4 sm:p-6` koyduk ve Step 4'te embedded çocuklardan padding'i düşürüyoruz; Step 8'de tarayıcıda çift-padding olmadığı gözle doğrulanır.

- [ ] **Step 4: CashPage + AccountingBackOfficePage'e `embedded` prop ekle**

`CashPage.tsx` — imza ve sarmalayıcı (mevcut satır 24 ve 33-38):
```tsx
export default function CashPage({ embedded = false }: { embedded?: boolean }) {
  const fmt = useFormatCurrency();
  const [tab, setTab] = useState<Tab>('sessions');
  // ... tabs array değişmez ...
  return (
    <div className={embedded ? 'space-y-6' : 'p-4 sm:p-6 space-y-6'}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold">Nakit & ÖKC</h1>
          <p className="text-sm text-slate-500">Vardiya mutabakatı, kasa hareketleri, bahşiş dağıtımı ve yazarkasa.</p>
        </div>
      )}
```
(başlık metinleri Task 5'te i18n'e geçecek; şimdilik yalnız gizleme.)

`AccountingBackOfficePage.tsx` — imza, sarmalayıcı ve tab init (mevcut satır 27-44):
```tsx
import { useSearchParams } from 'react-router-dom';
// ...
const VALID_TABS: readonly Tab[] = ['invoices', 'edoc', 'settings'];

export default function AccountingBackOfficePage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation('settings');
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(
    VALID_TABS.includes(requestedTab as Tab) ? (requestedTab as Tab) : 'invoices',
  );
  // ... tabs array değişmez ...
  return (
    <div className={embedded ? 'space-y-6' : 'p-4 sm:p-6 space-y-6'}>
      {!embedded && (
        <div>
          <h1 className="text-2xl font-bold">{t('accounting.backoffice.title')}</h1>
          <p className="text-sm text-slate-500">{t('accounting.backoffice.subtitle')}</p>
        </div>
      )}
```

- [ ] **Step 5: App.tsx — lazy def, yeni rota, 4 redirect**

Lazy def bloğuna ekle (CashPage def'inin yanına, ~satır 144):
```ts
const FinancePage = lazyWithReload(() => import("./pages/admin/FinancePage"));
```
Rota değişimleri (verbatim eski → yeni):
```tsx
{/* Finans — Kasa (eski Nakit & ÖKC) + Belgeler (eski Muhasebe/Faturalar/
    Fiş Kurtarma) tek çatı. Gate yok: yasal çekirdek her planda. */}
<Route path="/admin/finance" element={<FinancePage />} />
{/* Eski para rotaları Finans'a yönlenir. */}
<Route path="/admin/cash" element={<Navigate to="/admin/finance?group=cash" replace />} />
<Route
  path="/admin/accounting-backoffice"
  element={<Navigate to="/admin/finance?group=documents" replace />}
/>
<Route
  path="/admin/invoices"
  element={<Navigate to="/admin/finance?group=documents" replace />}
/>
<Route
  path="/admin/fiscal-recovery"
  element={<Navigate to="/admin/finance?group=documents&tab=edoc" replace />}
/>
```
Eski `/admin/cash` (496), `/admin/accounting-backoffice` FeatureGate'li blok (497-507), `/admin/invoices` (543), `/admin/fiscal-recovery` FeatureGate'li blok (801-811) SİLİNİR. Artık kullanılmayan lazy def'ler (`CashPage`, `AccountingBackOfficePage`, `InvoicesPage`) ve satır 226'daki `import FiscalRecoveryPage …` KALDIRILIR (FinancePage kendi import ediyor; FiscalRecovery Task 2'de Belgeler'e gömülüyor). `InvoicesPage`'in named export'u (`InvoicesPanel`) etkilenmez.

- [ ] **Step 6: Sidebar — tek Finans girişi**

`Sidebar.tsx` Operasyon items: `/admin/cash` (62-68) ve `/admin/accounting-backoffice` (69-76) öğeleri SİLİNİR, yerine TEK öğe:
```ts
      {
        // Finans: Nakit & ÖKC + Muhasebe + Fiş Kurtarma tek çatı (FinancePage).
        // Gate yok — kasa + fatura kesme yasal çekirdek, her planda.
        to: '/admin/finance',
        icon: Wallet,
        labelKey: 'navigation.finance',
        labelFallback: 'Finans',
        roles: [UserRole.ADMIN, UserRole.MANAGER],
      },
```
`planAndAccess` bölümündeki `/admin/fiscal-recovery` öğesi (256-262) SİLİNİR. Kullanılmayan ikon importları (`Receipt`, `FileWarning`) temizlenir (başka kullanım yoksa).

- [ ] **Step 7: i18n — 5 locale'e anahtarlar**

`common.json` → `navigation` bloğuna `finance`, top-level'a `finance` bloğu. Değerler:

| key | tr | en | ru | ar | uz |
|---|---|---|---|---|---|
| `navigation.finance` | Finans | Finance | Финансы | المالية | Moliya |
| `finance.groups.cash` | Kasa | Cash | Касса | الصندوق | Kassa |
| `finance.groups.documents` | Belgeler | Documents | Документы | المستندات | Hujjatlar |

tr örneği (diğer 4 locale aynı yapıda kendi değerleriyle):
```json
"navigation": { "...": "...", "finance": "Finans", "sections": { "...": "..." } },
"finance": {
  "groups": { "cash": "Kasa", "documents": "Belgeler" }
}
```

- [ ] **Step 8: Testler + parite + tip; elle doğrulama**

Run: `npm run test:ci -- src/pages/admin/__tests__/FinancePage.groups.test.tsx` → PASS.
Run: `cd .. && node scripts/check-i18n-parity.mjs && cd frontend` → exit 0.
Run: `npx tsc --noEmit` → 0 hata.
Run: `npm run test:ci` (tam paket) → eski rotaya bağlı test varsa (grep: `admin/cash|accounting-backoffice|admin/invoices|fiscal-recovery` src/ içinde test dosyaları) redirect'e göre güncelle, hepsi PASS.
Elle: `npm run dev` → `/admin/finance` çift padding yok; `/admin/cash` redirect çalışıyor; sidebar'da tek "Finans".

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(finance): unified Finance hub shell (cash+documents groups, old money routes redirect)"
```

---

### Task 2: Belgeler grubu — Fiş Kurtarma'yı göm, sekmeyi yeniden adlandır (Faz 1b)

**Files:**
- Modify: `frontend/src/pages/admin/AccountingBackOfficePage.tsx` (EDocTab)
- Modify: `frontend/src/features/fiscal/FiscalRecoveryPage.tsx` (embedded prop)
- Modify: `frontend/src/i18n/locales/{ar,en,ru,tr,uz}/settings.json` (`accounting.backoffice.tabEdoc` değeri)
- Test: `frontend/src/pages/admin/__tests__/AccountingPage.tabs.test.tsx` (güncelle)

**Interfaces:**
- Consumes: Task 1'in `AccountingBackOfficePage` embedded yapısı.
- Produces: `FiscalRecoveryPage({ embedded?: boolean })` — Task 6 cihaz panelini buradan AYIRACAK; şimdilik kuyruk+kayıt paneli birlikte gömülü (spec §5 Faz 1 notu).

- [ ] **Step 1: Mevcut tab testine failing beklenti ekle**

`AccountingPage.tabs.test.tsx`'e mock + test ekle (mevcut mock bloğunun altına):
```tsx
vi.mock('../../../features/fiscal/FiscalRecoveryPage', () => ({
  default: () => <div>FIS-KURTARMA</div>,
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasIntegration: (d: string) => d === 'fiscal' }),
}));
```
```tsx
  it('e-Belge sekmesi fiscal entegrasyonu varken fiş kurtarma bölümünü içerir', () => {
    render(<AccountingBackOfficePage />);
    fireEvent.click(screen.getByRole('button', { name: /Undelivered|Gönderilemeyen/ }));
    expect(screen.getByText('FIS-KURTARMA')).toBeTruthy();
  });
```

- [ ] **Step 2: FAIL gör**

Run: `npm run test:ci -- src/pages/admin/__tests__/AccountingPage.tabs.test.tsx`
Expected: FAIL (buton adı eski "e-Document Status"; FIS-KURTARMA yok).

- [ ] **Step 3: FiscalRecoveryPage'e embedded prop**

```tsx
export default function FiscalRecoveryPage({ embedded = false }: { embedded?: boolean }) {
  // ... hooks değişmez ...
  return (
    <div className={embedded ? 'space-y-4' : 'space-y-4 p-6'}>
      {!embedded && (
        <header className="flex items-center justify-between">
          {/* mevcut header aynen — sadece embedded'da gizli */}
        </header>
      )}
```
(embedded'da yenile düğmesi kaybolmasın: header gizlenince `refetch` düğmesini kuyruk başlığının yanına taşı: `<h2 className="pt-2 text-lg font-semibold flex items-center justify-between">{t('hummytummy.fiscalRecovery.title')}<button onClick={() => refetch()} className="rounded border px-3 py-1.5 text-sm font-normal hover:bg-gray-50">{t('hummytummy.fiscalRecovery.refresh')}</button></h2>` — embedded olsun olmasın bu konumda; eski header'daki kopya yalnız `!embedded`'da.)

- [ ] **Step 4: EDocTab'e fiscal bölümünü ekle**

`AccountingBackOfficePage.tsx` — importlar:
```tsx
import { useSubscription } from '../../contexts/SubscriptionContext';
import FiscalRecoveryPage from '../../features/fiscal/FiscalRecoveryPage';
```
`EDocTab` return'ünün sonuna (resync Card'ından sonra), hide-not-403:
```tsx
function EDocTab() {
  const { t } = useTranslation('settings');
  const { hasIntegration } = useSubscription();
  // ... mevcut readiness + resync kartları aynen ...
      {/* Yazarkasa fiş kuyruğu — yalnız fiscal entegrasyonu olan tenant'ta.
          (Eski /admin/fiscal-recovery sayfası; cihaz kayıt paneli Faz 4'te
          şube hub'ına ayrışacak.) */}
      {hasIntegration('fiscal') && <FiscalRecoveryPage embedded />}
    </div>
  </QueryStateGate>
```

- [ ] **Step 5: Sekme adı — 5 locale**

`settings.json` `accounting.backoffice.tabEdoc` değerleri: tr `"Gönderilemeyenler & Durum"`, en `"Undelivered & Status"`, ru `"Неотправленные и статус"`, ar `"غير المرسلة والحالة"`, uz `"Yuborilmaganlar va holat"`.

- [ ] **Step 6: PASS + parite + commit**

Run: `npm run test:ci -- src/pages/admin/__tests__/AccountingPage.tabs.test.tsx` → PASS; `cd .. && node scripts/check-i18n-parity.mjs` → 0.
```bash
git add -A && git commit -m "feat(finance): fold fiscal recovery into Documents group, rename e-doc tab"
```

---

### Task 3: Genel Bakış grubu (Faz 2)

**Files:**
- Create: `frontend/src/pages/admin/finance/FinanceOverview.tsx`
- Modify: `frontend/src/pages/admin/FinancePage.tsx` (`overview` grubu, varsayılan)
- Modify: `frontend/src/i18n/locales/{ar,en,ru,tr,uz}/common.json` (`finance.overview.*`, `finance.groups.overview`)
- Test: `frontend/src/pages/admin/finance/FinanceOverview.test.tsx`

**Interfaces:**
- Consumes: `useCashierSessions(status?)`, `useListFiscalDevices()` (fiscalApi), `useAccountingSyncStatus(enabled)` (accountingApi — `failed: number`), `useListPendingReceipts()` (fiscalApi), `useTerminalReconciliation()` (paymentTerminalApi), `useSalesReport(range)` (reports), `StatCard` (`components/ui/StatCard`), `useSubscription().hasFeature/hasIntegration`.
- Produces: `FinanceOverview({ onNavigate })` — `onNavigate(group: 'cash' | 'documents', tab?: string)`.

- [ ] **Step 1: Failing test**

```tsx
// frontend/src/pages/admin/finance/FinanceOverview.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

declare global {
  // eslint-disable-next-line no-var
  var __features: string[];
  // eslint-disable-next-line no-var
  var __integrations: string[];
  // eslint-disable-next-line no-var
  var __sessions: unknown;
  // eslint-disable-next-line no-var
  var __xreports: Record<string, { expectedCash: number }>;
}

vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({
    hasFeature: (k: string) => globalThis.__features.includes(k),
    hasIntegration: (d: string) => globalThis.__integrations.includes(d),
  }),
}));
vi.mock('../../../features/cash/cashApi', () => ({
  useCashierSessions: () => globalThis.__sessions,
}));
vi.mock('@tanstack/react-query', () => ({
  useQueries: ({ queries }: { queries: { queryKey: unknown[] }[] }) =>
    queries.map((q) => ({
      data: globalThis.__xreports[String((q.queryKey as string[])[2])],
      isLoading: false,
    })),
}));
vi.mock('../../../features/fiscal/fiscalApi', () => ({
  useListFiscalDevices: () => ({ data: [{ id: 'd1', status: 'online', providerId: 'fiscal_paygo', serial: 'S1' }], isError: false }),
  useListPendingReceipts: () => ({ data: [{ id: 'r1' }], isError: false }),
}));
vi.mock('../../../features/accounting/accountingApi', () => ({
  useAccountingSyncStatus: () => ({ data: { failed: 2 } }),
}));
vi.mock('../../../features/payment-terminal/paymentTerminalApi', () => ({
  useTerminalReconciliation: () => ({ data: [] }),
}));
vi.mock('../../../features/reports/reportsApi', () => ({
  useSalesReport: () => ({ data: { totalSales: 1234 }, isLoading: false, isError: false }),
}));
vi.mock('../../../hooks/useFormatCurrency', () => ({
  useFormatCurrency: () => (n: number) => `₺${n}`,
}));
vi.mock('react-router-dom', () => ({ Link: (p: { to: string; children: React.ReactNode }) => <a href={p.to}>{p.children}</a> }));

import FinanceOverview from './FinanceOverview';

describe('FinanceOverview', () => {
  it('kasa + gönderilemeyen belge sayacı + yazarkasa durumu; satış kartı feature ile', () => {
    globalThis.__features = ['advancedReports'];
    globalThis.__integrations = ['fiscal', 'accounting'];
    globalThis.__sessions = { data: [{ id: 's1', openedAt: new Date().toISOString(), openingFloat: '100' }], isLoading: false };
    globalThis.__xreports = { s1: { expectedCash: 4250 } };
    render(<FinanceOverview onNavigate={() => {}} />);
    expect(screen.getByText('₺4250')).toBeTruthy();      // beklenen nakit
    expect(screen.getByText('3')).toBeTruthy();           // 2 FAILED e-Belge + 1 bekleyen fiş
    expect(screen.getByText('₺1234')).toBeTruthy();       // bugünkü satış
  });

  it('advancedReports yoksa satış kartı hiç render edilmez; fiscal yoksa upsell', () => {
    globalThis.__features = [];
    globalThis.__integrations = [];
    globalThis.__sessions = { data: [], isLoading: false };
    globalThis.__xreports = {};
    render(<FinanceOverview onNavigate={() => {}} />);
    expect(screen.queryByText('₺1234')).toBeNull();
    expect(screen.getByText(/eklenti|add-on|Mağaza/i)).toBeTruthy();
  });

  it('dünden kalan açık vardiya uyarısı aksiyonla gelir', () => {
    globalThis.__features = [];
    globalThis.__integrations = [];
    globalThis.__sessions = {
      data: [{ id: 'old', openedAt: '2020-01-01T10:00:00Z', openingFloat: '0' }],
      isLoading: false,
    };
    globalThis.__xreports = { old: { expectedCash: 10 } };
    const nav = vi.fn();
    render(<FinanceOverview onNavigate={nav} />);
    fireEvent.click(screen.getByRole('button', { name: /kapat|close/i }));
    expect(nav).toHaveBeenCalledWith('cash');
  });
});
```

- [ ] **Step 2: FAIL gör**

Run: `npm run test:ci -- src/pages/admin/finance/FinanceOverview.test.tsx`
Expected: FAIL — modül yok.

- [ ] **Step 3: FinanceOverview'u yaz**

```tsx
// frontend/src/pages/admin/finance/FinanceOverview.tsx
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Banknote, Printer, FileWarning, CreditCard, TrendingUp } from 'lucide-react';
import { format, addDays, startOfDay } from 'date-fns';
import StatCard from '../../../components/ui/StatCard';
import { useSubscription } from '../../../contexts/SubscriptionContext';
import { useFormatCurrency } from '../../../hooks/useFormatCurrency';
import { useCashierSessions } from '../../../features/cash/cashApi';
import { useListFiscalDevices, useListPendingReceipts } from '../../../features/fiscal/fiscalApi';
import { useAccountingSyncStatus } from '../../../features/accounting/accountingApi';
import { useTerminalReconciliation } from '../../../features/payment-terminal/paymentTerminalApi';
import { useSalesReport } from '../../../features/reports/reportsApi';
import api from '../../../lib/api';

/**
 * Finans → Genel Bakış. "Bugün ne durumdayım?" tek ekranda: kasadaki beklenen
 * nakit, açık vardiyalar (+dünden kalan uyarısı), bugünkü satış (advancedReports
 * varsa), yazarkasa sağlığı (fiscal yoksa DÜRÜST upsell), gönderilemeyen belge
 * sayacı, mutabakat bekleyen çekimler. Tamamı MEVCUT uçlardan — yeni backend yok.
 * Rules-of-hooks: entegrasyon-koşullu sorgular gate'li SARMALAYICI bileşende
 * (KpiStrip deseni, bkz. DashboardPage.TodayKpiStrip) — koşulsuz hook çağrısı.
 */
type NavigateFn = (group: 'cash' | 'documents', tab?: string) => void;

export default function FinanceOverview({ onNavigate }: { onNavigate: NavigateFn }) {
  const { t } = useTranslation('common');
  const fmt = useFormatCurrency();
  const { hasFeature, hasIntegration } = useSubscription();
  const { data: sessions = [], isLoading: sessionsLoading } = useCashierSessions('OPEN');

  // Açık vardiyaların X-report'ları — beklenen nakit toplamı.
  const xReports = useQueries({
    queries: (sessions as { id: string }[]).map((s) => ({
      queryKey: ['cash', 'x-report', s.id],
      queryFn: async () => (await api.get(`/cash-drawer/sessions/${s.id}/x-report`)).data,
    })),
  });
  const expectedCash = xReports.reduce(
    (sum, q) => sum + (q.data?.expectedCash ?? 0), 0);
  const staleSessions = (sessions as { id: string; openedAt: string }[]).filter(
    (s) => new Date(s.openedAt) < startOfDay(new Date()),
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <button type="button" onClick={() => onNavigate('cash')} className="text-left">
          <StatCard
            title={t('finance.overview.expectedCash', 'Kasadaki beklenen nakit')}
            value={fmt(expectedCash)}
            icon={Banknote}
            color="bg-emerald-500"
            isLoading={sessionsLoading}
          />
        </button>
        <button type="button" onClick={() => onNavigate('cash')} className="text-left">
          <StatCard
            title={t('finance.overview.openSessions', 'Açık vardiya')}
            value={sessions.length}
            icon={CreditCard}
            color="bg-indigo-500"
            isLoading={sessionsLoading}
          />
        </button>
        {hasFeature('advancedReports') && <TodaySalesCard />}
        {hasIntegration('fiscal') ? <FiscalStatusCard /> : <FiscalUpsellCard />}
      </div>

      <DocumentsCounterRow onNavigate={onNavigate} />
      <ReconciliationRow />

      {staleSessions.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>
            {t('finance.overview.staleSessionWarning', {
              defaultValue: 'Dünden kalan {{count}} açık vardiya var — gün sonu mutabakatı yapılmadı.',
              count: staleSessions.length,
            })}
          </span>
          <button
            type="button"
            onClick={() => onNavigate('cash')}
            className="rounded-md bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-700"
          >
            {t('finance.overview.closeAction', 'Kapat')}
          </button>
        </div>
      )}
    </div>
  );
}

/** advancedReports garantili çağrılır (gate dışarıda) — hook koşulsuz. */
function TodaySalesCard() {
  const { t } = useTranslation('common');
  const fmt = useFormatCurrency();
  const now = new Date();
  const range = { startDate: format(now, 'yyyy-MM-dd'), endDate: format(addDays(now, 1), 'yyyy-MM-dd') };
  const { data, isLoading } = useSalesReport(range);
  return (
    <StatCard
      title={t('finance.overview.todaysSales', 'Bugünkü satış')}
      value={fmt(data?.totalSales ?? 0)}
      icon={TrendingUp}
      color="bg-blue-500"
      isLoading={isLoading}
    />
  );
}

function FiscalStatusCard() {
  const { t } = useTranslation('common');
  const { data: devices = [], isError } = useListFiscalDevices();
  const list = isError ? [] : devices;
  const online = list.filter((d) => d.status === 'online').length;
  return (
    <StatCard
      title={t('finance.overview.fiscalDevices', 'Yazarkasa')}
      value={list.length === 0
        ? t('finance.overview.fiscalNone', 'Kurulmadı')
        : `${online}/${list.length} ${t('finance.overview.fiscalReady', 'hazır')}`}
      icon={Printer}
      color={online > 0 ? 'bg-emerald-500' : 'bg-slate-400'}
    />
  );
}

/** Dürüst upsell — eski "cihaz yapılandırılmamış" sessizliğinin yerine. */
function FiscalUpsellCard() {
  const { t } = useTranslation('common');
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
      <p className="font-medium">{t('finance.overview.fiscalUpsellTitle', 'Yazarkasa bağlantısı')}</p>
      <p className="mt-1 text-xs">
        {t('finance.overview.fiscalUpsellBody', 'Mali fiş basmak için yazarkasa eklentisi gerekir.')}
      </p>
      <Link to="/admin/store" className="mt-2 inline-block text-xs font-semibold text-indigo-600 hover:underline">
        {t('finance.overview.fiscalUpsellCta', 'Mağazaya git')}
      </Link>
    </div>
  );
}

/** Sayaç iki koşullu kaynaktan — her kaynak kendi gate'li sarmalayıcısında toplanamaz
 *  (tek sayı gerekiyor); bu yüzden alt bileşen entegrasyon setine göre AYRI render edilir. */
function DocumentsCounterRow({ onNavigate }: { onNavigate: NavigateFn }) {
  const { hasIntegration } = useSubscription();
  const acc = hasIntegration('accounting');
  const fis = hasIntegration('fiscal');
  if (!acc && !fis) return null;
  return <DocumentsCounterInner acc={acc} fis={fis} onNavigate={onNavigate} />;
}

function DocumentsCounterInner({ acc, fis, onNavigate }: { acc: boolean; fis: boolean; onNavigate: NavigateFn }) {
  const { t } = useTranslation('common');
  const sync = useAccountingSyncStatus(acc);
  const pending = useListPendingReceipts();
  const failedDocs = (acc ? (sync.data?.failed ?? 0) : 0) + (fis ? (pending.data?.length ?? 0) : 0);
  if (failedDocs === 0) return null;
  return (
    <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <span>
        {t('finance.overview.failedDocs', { defaultValue: 'Gönderilemeyen belge:' })}{' '}
        <strong className="tabular-nums">{failedDocs}</strong>
      </span>
      <button
        type="button"
        onClick={() => onNavigate('documents', 'edoc')}
        className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700"
      >
        {t('finance.overview.fixAction', 'Düzelt')}
      </button>
    </div>
  );
}

function ReconciliationRow() {
  const { t } = useTranslation('common');
  const { data = [] } = useTerminalReconciliation();
  if (data.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      {t('finance.overview.reconciliation', {
        defaultValue: '{{count}} kart çekimi mutabakat bekliyor — şube cihaz sayfasından inceleyin.',
        count: data.length,
      })}
    </div>
  );
}
```
DİKKAT (rules of hooks): `DocumentsCounterInner`'da `useListPendingReceipts` fiscal entegrasyonu olmayan tenant'ta da çağrılır ve 403 alabilir — sorgu `isError`'a düşer, sayaç 0 katkı alır; istek atılmasın istiyorsan `fis === false` iken Inner yerine yalnız-accounting varyantı render etmek yerine BASİT tut: `DocumentsCounterRow` zaten `!acc && !fis`'te null; `fis=false&&acc=true` durumunda tek gereksiz istek kabul edilebilir DEĞİL — bu yüzden Inner'ı ikiye ayır: `fis` true iken `<WithFiscal…>` (iki hook), değilken `<AccountingOnly…>` (tek hook). Uygularken bu ayrımı yap; test 1 `acc+fis`, ek bir assertion gerekmiyor.

- [ ] **Step 4: FinancePage'e overview grubunu ekle (varsayılan)**

`FinancePage.tsx` değişiklikleri:
```tsx
import { LayoutDashboard, Wallet, Receipt } from 'lucide-react';
import FinanceOverview from './finance/FinanceOverview';

type Group = 'overview' | 'cash' | 'documents';
const VALID_GROUPS: readonly Group[] = ['overview', 'cash', 'documents'];
// varsayılan:
  const [group, setGroup] = useState<Group>(
    VALID_GROUPS.includes(requested as Group) ? (requested as Group) : 'overview',
  );
// docTab state'i — overview'dan Belgeler'e sekme hedefiyle geçiş için:
  const [docTab, setDocTab] = useState<string | undefined>(undefined);
  const groups = [
    { id: 'overview' as const, label: t('finance.groups.overview', 'Genel Bakış'), icon: LayoutDashboard },
    { id: 'cash' as const, label: t('finance.groups.cash', 'Kasa'), icon: Wallet },
    { id: 'documents' as const, label: t('finance.groups.documents', 'Belgeler'), icon: Receipt },
  ];
// render:
      {group === 'overview' && (
        <FinanceOverview
          onNavigate={(g, tab) => {
            setDocTab(tab);
            setGroup(g);
          }}
        />
      )}
      {group === 'cash' && <CashPage embedded />}
      {group === 'documents' && <AccountingBackOfficePage embedded initialTab={docTab} />}
```
`AccountingBackOfficePage`'e opsiyonel `initialTab` prop'u: `({ embedded = false, initialTab }: { embedded?: boolean; initialTab?: string })`; tab init önceliği `initialTab` → query-param → `'invoices'` (`VALID_TABS.includes` kontrolüyle).
FinancePage testine ekle: varsayılanın artık overview olduğunu doğrula (`vi.mock('./finance/FinanceOverview', …)` → `GENEL-BAKIS` markörü; ilk render'da `KASA-PANEL` DEĞİL `GENEL-BAKIS` beklenir; `?group=cash` testi korunur).

- [ ] **Step 5: i18n — `finance.groups.overview` + `finance.overview.*` 5 locale**

| key | tr | en | ru | ar | uz |
|---|---|---|---|---|---|
| `finance.groups.overview` | Genel Bakış | Overview | Обзор | نظرة عامة | Umumiy ko'rinish |
| `finance.overview.expectedCash` | Kasadaki beklenen nakit | Expected cash in drawer | Ожидаемая наличность | النقد المتوقع في الدرج | Kassadagi kutilgan naqd |
| `finance.overview.openSessions` | Açık vardiya | Open shifts | Открытые смены | الورديات المفتوحة | Ochiq smenalar |
| `finance.overview.todaysSales` | Bugünkü satış | Today's sales | Продажи за сегодня | مبيعات اليوم | Bugungi savdo |
| `finance.overview.fiscalDevices` | Yazarkasa | Cash register | Кассовый аппарат | آلة تسجيل النقد | Kassa apparati |
| `finance.overview.fiscalNone` | Kurulmadı | Not set up | Не настроен | غير مهيأ | Sozlanmagan |
| `finance.overview.fiscalReady` | hazır | ready | готово | جاهز | tayyor |
| `finance.overview.fiscalUpsellTitle` | Yazarkasa bağlantısı | Cash register connection | Подключение кассы | ربط آلة النقد | Kassa ulanishi |
| `finance.overview.fiscalUpsellBody` | Mali fiş basmak için yazarkasa eklentisi gerekir. | Printing fiscal receipts requires the cash register add-on. | Для печати фискальных чеков нужен модуль кассы. | تتطلب طباعة الإيصالات المالية إضافة آلة النقد. | Fiskal chek chiqarish uchun kassa qo'shimchasi kerak. |
| `finance.overview.fiscalUpsellCta` | Mağazaya git | Go to store | В магазин | إلى المتجر | Do'konga o'tish |
| `finance.overview.staleSessionWarning` | Dünden kalan {{count}} açık vardiya var — gün sonu mutabakatı yapılmadı. | {{count}} shift(s) left open from yesterday — day-end reconciliation is missing. | Со вчерашнего дня открыто смен: {{count}} — сверка не выполнена. | هناك {{count}} وردية مفتوحة من الأمس — لم تتم تسوية نهاية اليوم. | Kechadan {{count}} smena ochiq qolgan — kun yakuni solishtiruvi qilinmagan. |
| `finance.overview.closeAction` | Kapat | Close | Закрыть | إغلاق | Yopish |
| `finance.overview.failedDocs` | Gönderilemeyen belge: | Undelivered documents: | Неотправленные документы: | مستندات غير مرسلة: | Yuborilmagan hujjatlar: |
| `finance.overview.fixAction` | Düzelt | Fix | Исправить | إصلاح | Tuzatish |
| `finance.overview.reconciliation` | {{count}} kart çekimi mutabakat bekliyor — şube cihaz sayfasından inceleyin. | {{count}} card charge(s) need reconciliation — review on the branch devices page. | Ожидают сверки: {{count}} — проверьте на странице устройств филиала. | {{count}} عملية بطاقة بانتظار التسوية — راجعها في صفحة أجهزة الفرع. | {{count}} karta to'lovi solishtiruvni kutmoqda — filial qurilmalar sahifasida ko'ring. |

- [ ] **Step 6: PASS + parite + tip + commit**

Run: hedef test + FinancePage testi + `npx tsc --noEmit` + `node scripts/check-i18n-parity.mjs` → hepsi temiz.
```bash
git add -A && git commit -m "feat(finance): overview group — today cards, warnings, honest fiscal upsell"
```

---

### Task 4: Z-Raporları → Kasa "Gün Sonu"; ölü sayfa temizliği (Faz 3a)

**Files:**
- Modify: `frontend/src/pages/admin/CashPage.tsx` (yeni sekme)
- Modify: `frontend/src/pages/admin/ReportsPage.tsx` (zreports sekmesi kalkar; satır 55, ~117 allTabs, 30 import, 399-401 render)
- Delete: `frontend/src/pages/admin/ZReportsPage.tsx` (route edilmemiş yetim — önce `grep -rn "ZReportsPage" frontend/src` ile kullanılmadığını DOĞRULA)
- Test: `frontend/src/pages/admin/__tests__/CashPage.tabs.test.tsx` (yeni)

**Interfaces:**
- Consumes: `ZReportsSection` (`components/reports/ZReportsSection`, prop'suz render).
- Produces: CashPage Tab tipi `'sessions' | 'safe' | 'tips' | 'dayend'` — Task 5 bu diziyi i18n'ler.

- [ ] **Step 1: Failing test**

```tsx
// frontend/src/pages/admin/__tests__/CashPage.tabs.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CashPage from '../CashPage';

vi.mock('../../../features/cash/cashApi', () => ({
  useCashierSessions: () => ({ data: [], isLoading: false }),
  useXReport: () => ({ data: undefined, isLoading: false }),
  useCreateCashMovement: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false }),
  useTipDistribution: () => ({ data: undefined, isLoading: false, isError: false }),
  downloadSessionsCsv: vi.fn(),
}));
vi.mock('../../../components/reports/ZReportsSection', () => ({
  default: () => <div>GUN-SONU-PANEL</div>,
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: () => true, hasIntegration: () => false }),
}));

describe('CashPage — Gün Sonu sekmesi', () => {
  it('Gün Sonu sekmesi ZReportsSection render eder; ÖKC sekmesi YOK', () => {
    render(<CashPage />);
    fireEvent.click(screen.getByRole('button', { name: /Gün Sonu|Day-End/ }));
    expect(screen.getByText('GUN-SONU-PANEL')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /ÖKC/ })).toBeNull();
  });
});
```
(ÖKC sekmesinin kaldırılması Task 5'te — bu test Task 5 sonuna kadar `queryByRole ÖKC` beklentisi olmadan başlar; assertion'ı Task 5'te ekle. Step 1'de yalnız ilk iki beklentiyle yaz.)

- [ ] **Step 2: FAIL gör** — `npm run test:ci -- src/pages/admin/__tests__/CashPage.tabs.test.tsx` → FAIL ("Gün Sonu" butonu yok).

- [ ] **Step 3: CashPage'e sekme ekle, ReportsPage'den çıkar**

`CashPage.tsx`:
```tsx
import ZReportsSection from '../../components/reports/ZReportsSection';
import { FileText } from 'lucide-react'; // mevcut lucide importuna ekle

type Tab = 'sessions' | 'safe' | 'tips' | 'okc' | 'dayend';
// tabs dizisine (okc'den önce):
    { id: 'dayend', label: 'Gün Sonu', icon: FileText },
// render bloklarına:
      {tab === 'dayend' && <ZReportsSection />}
```
"Z geçmişi CSV indir" düğmesini `SessionsTab`'dan `dayend` bloğuna taşı:
```tsx
      {tab === 'dayend' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              onClick={async () => {
                try { await downloadSessionsCsv(); }
                catch { toast.error('CSV indirilemedi — tekrar deneyin.'); }
              }}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              Kapanmış vardiya dökümü (CSV)
            </button>
          </div>
          <ZReportsSection />
        </div>
      )}
```
(`SessionsTab` içindeki CSV `div`'i SİLİNİR; metinler Task 5'te i18n olur.)

`ReportsPage.tsx`: `TabType`'tan `'zreports'` çıkar; `allTabs`'tan zreports satırı çıkar; satır 30 import + 399-401 render bloğu SİLİNİR.

- [ ] **Step 4: Yetim sayfayı sil**

```bash
grep -rn "ZReportsPage" frontend/src
```
Expected: yalnız `pages/admin/ZReportsPage.tsx` kendisi. Sonra `git rm frontend/src/pages/admin/ZReportsPage.tsx`.
(Başka kullanım çıkarsa SİLME, raporla.)

- [ ] **Step 5: PASS + Reports testleri + commit**

Run: hedef test PASS; `npm run test:ci` tam — ReportsPage'e dokunan testlerde zreports beklentisi varsa kaldır.
```bash
git add -A && git commit -m "feat(finance): move Z day-end reports into Cash group, drop orphan ZReportsPage"
```

---

### Task 5: CashPage tam i18n + jargon + Bahşiş gizleme + ÖKC sekmesi kaldırma (Faz 3b)

**Files:**
- Modify: `frontend/src/pages/admin/CashPage.tsx` (tamamı i18n; OkcTab silinir)
- Modify: `frontend/src/i18n/locales/{ar,en,ru,tr,uz}/common.json` (`cash.*` bloğu)
- Test: `frontend/src/pages/admin/__tests__/CashPage.tabs.test.tsx` (genişlet)

**Interfaces:**
- Consumes: Task 4'ün Tab yapısı; `useSubscription().hasFeature('advancedReports')` (Bahşiş sekme-gizleme).
- Produces: `cash.*` i18n anahtarları (aşağıdaki tablo) — Task 9 parite kontrolünden geçer.

- [ ] **Step 1: Teste yeni beklentiler ekle (FAIL)**

Mevcut suite'e:
```tsx
  it('advancedReports yokken Bahşiş sekmesi GİZLİ (403-upsell çıkmazı bitti)', () => {
    features = [];               // useSubscription mock'unu değişkene bağla
    render(<CashPage />);
    expect(screen.queryByRole('button', { name: /Bahşiş|Tips/ })).toBeNull();
  });
  it('ekranda çıplak enum yok', () => {
    features = ['advancedReports'];
    render(<CashPage />);
    fireEvent.click(screen.getByRole('button', { name: /Hareket|Movements/ }));
    expect(screen.queryByText(/SAFE_DROP/)).toBeNull();
    expect(screen.queryByText(/Petty/i)).toBeNull();
  });
```
(mock'u `let features: string[] = []; vi.mock(... hasFeature: (k) => features.includes(k) ...)` biçimine çevir.) ÖKC yokluğu assertion'ını da şimdi ekle (Task 4 Step 1 notu).

- [ ] **Step 2: FAIL gör** — Bahşiş hâlâ görünür, SAFE_DROP ekranda.

- [ ] **Step 3: CashPage'i i18n'le ve sadeleştir**

Yapısal değişiklikler:
1. `import { useTranslation } from 'react-i18next';` + `const { t } = useTranslation('common');` (CashPage + her alt bileşen).
2. `useSubscription` import; tabs dizisi filtreli:
```tsx
  const { hasFeature } = useSubscription();
  const allTabs = [
    { id: 'sessions' as Tab, label: t('cash.tabs.sessions', 'Vardiyalar'), icon: Wallet, gate: undefined as string | undefined },
    { id: 'safe' as Tab, label: t('cash.tabs.safe', 'Kasa Hareketleri'), icon: Landmark, gate: undefined },
    { id: 'dayend' as Tab, label: t('cash.tabs.dayend', 'Gün Sonu'), icon: FileText, gate: undefined },
    { id: 'tips' as Tab, label: t('cash.tabs.tips', 'Bahşiş'), icon: Coins, gate: 'advancedReports' },
  ];
  const tabs = allTabs.filter((tb) => !tb.gate || hasFeature(tb.gate as keyof PlanFeatures));
```
3. `Tab` tipi `'sessions' | 'safe' | 'tips' | 'dayend'` (okc çıkar); `OkcTab` bileşeni ve `useListFiscalDevices` importu SİLİNİR (durum Genel Bakış'ta, kayıt Task 6'da şube hub'ında). `TipsTab`'daki 403-upsell dalı SİLİNİR (sekme artık gate'siz görünmüyor; kalan hata dalı yalnız retry mesajı).
4. TÜM hardcoded metinler `t()` — anahtar tablosu (5 locale; tr=mevcut metnin sadeleşmişi):

| key | tr | en |
|---|---|---|
| `cash.title` | Kasa | Cash |
| `cash.subtitle` | Vardiya mutabakatı, kasa hareketleri ve gün sonu. | Shift reconciliation, cash movements and day-end. |
| `cash.tabs.sessions` | Vardiyalar | Shifts |
| `cash.tabs.safe` | Kasa Hareketleri | Cash Movements |
| `cash.tabs.dayend` | Gün Sonu | Day-End |
| `cash.tabs.tips` | Bahşiş | Tips |
| `cash.sessions.open` | Açık vardiyalar | Open shifts |
| `cash.sessions.none` | Açık vardiya yok. | No open shifts. |
| `cash.sessions.row` | Vardiya {{id}} — açılış {{amount}} | Shift {{id}} — opening {{amount}} |
| `cash.xreport.title` | Anlık kasa özeti (kapatmadan) | Live drawer summary (without closing) |
| `cash.xreport.pick` | Soldan bir vardiya seçin. | Pick a shift on the left. |
| `cash.xreport.opening` | Açılış | Opening |
| `cash.xreport.cashSales` | Nakit satış | Cash sales |
| `cash.xreport.cashIn` | Kasa girişi | Cash in |
| `cash.xreport.cashOut` | Kasa çıkışı | Cash out |
| `cash.xreport.expected` | Beklenen nakit | Expected cash |
| `cash.safe.title` | Kasa hareketi | Cash movement |
| `cash.safe.desc` | Kasadan çıkan para — onaya düşer, vardiya mutabakatında çıkış olarak sayılır. | Money leaving the drawer — requires approval, counts as an outflow in shift reconciliation. |
| `cash.safe.typeSafeDrop` | Ana kasaya para devri | Transfer to main safe |
| `cash.safe.typeBankDeposit` | Banka yatırma | Bank deposit |
| `cash.safe.typePettyCash` | Küçük kasa | Petty cash |
| `cash.safe.typeCashOut` | Nakit çıkış | Cash out |
| `cash.safe.amount` | Tutar | Amount |
| `cash.safe.reason` | Açıklama | Description |
| `cash.safe.save` | Kaydet | Save |
| `cash.safe.saving` | Kaydediliyor… | Saving… |
| `cash.safe.saved` | Hareket kaydedildi (onay bekliyor). Tutar: {{amount}} | Movement recorded (pending approval). Amount: {{amount}} |
| `cash.safe.failed` | Hareket kaydedilemedi — tutarı kontrol edip tekrar deneyin. | Could not record — check the amount and retry. |
| `cash.tips.title` | Bahşiş dağıtımı — havuz {{pool}}, {{hours}} saat | Tip distribution — pool {{pool}}, {{hours}} hours |
| `cash.tips.error` | Rapor yüklenemedi — sayfayı yenileyip tekrar deneyin. | Could not load — refresh and retry. |
| `cash.tips.staff` | Personel | Staff |
| `cash.tips.hours` | Saat | Hours |
| `cash.tips.share` | Pay | Share |
| `cash.tips.undistributed` | Dağıtılmayan: {{amount}} (saat girilmemiş). | Undistributed: {{amount}} (no hours entered). |
| `cash.dayend.csv` | Kapanmış vardiya dökümü (CSV) | Closed-shift export (CSV) |
| `cash.dayend.csvError` | CSV indirilemedi — tekrar deneyin. | Download failed — retry. |
| `cash.loading` | Yükleniyor… | Loading… |
| `cash.empty` | Kayıt yok. | No records. |

ru/ar/uz değerleri: uygulayıcı tr/en anlamını koruyarak çevirir (mevcut locale dosyalarındaki komşu bloklardaki üslubu izle; ör. ru resmi "смена/касса" terminolojisi, uz Latin alfabesi). SELECT option'ları: `value` enum AYNEN kalır (`SAFE_DROP` backend sözleşmesi), yalnız GÖRÜNEN etiket değişir.
5. Sayfa başlığı embedded'da zaten gizli (Task 1); `!embedded` dalındaki başlık `t('cash.title')/t('cash.subtitle')` olur.

- [ ] **Step 4: PASS + parite + tam suite + commit**

Run: hedef test PASS; `node scripts/check-i18n-parity.mjs` → 0; `node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json` → 0 (yeni İngilizce-placeholder yok — ru/ar/uz GERÇEK çeviri olmalı); `npm run test:ci` tam PASS.
```bash
git add -A && git commit -m "feat(finance): full i18n for Cash page, plain-language labels, hide gated Tips tab"
```

---

### Task 6: Cihaz birleşimi — şube hub'ı (Faz 4)

**Files:**
- Create: `frontend/src/features/fiscal/FiscalDevicesPanel.tsx` (FiscalRecoveryPage'den ayrıştır)
- Create: `frontend/src/features/devices/HardwareDevicesSection.tsx` (IntegrationsSettingsPage'den ayrıştır)
- Modify: `frontend/src/features/branches/BranchDetailPage.tsx` (5 sekme)
- Modify: `frontend/src/pages/settings/PaymentTerminalsSettingsPage.tsx` (`PaymentTerminalsPanel` named export'a çevir)
- Modify: `frontend/src/features/fiscal/FiscalRecoveryPage.tsx` (cihaz paneli çıkar — yalnız kuyruk kalır)
- Modify: `frontend/src/pages/settings/IntegrationsSettingsPage.tsx` (donanım kartı çıkar)
- Modify: `frontend/src/pages/settings/SettingsLayout.tsx` (payment-terminals + accounting nav öğeleri çıkar)
- Modify: `frontend/src/App.tsx` (settings alt rotaları redirect)
- Modify: `frontend/src/i18n/locales/{ar,en,ru,tr,uz}/common.json` (`hummytummy.branchDetail.tabs.*` yeni anahtarlar + `branchDetail.scopeHint`)
- Test: `frontend/src/features/branches/__tests__/BranchDetailPage.tabs.test.tsx` (yeni)

**Interfaces:**
- Consumes: Task 2'nin embedded `FiscalRecoveryPage`'i; `PaymentTerminalsSettingsPage` iç yapısı (yukarıdaki verbatim alıntı); `useBranchScopeStore((s) => s.branchId)`.
- Produces: `FiscalDevicesPanel` (named default yok — `export function FiscalDevicesPanel()`), `PaymentTerminalsPanel` (named export, chrome-free), `HardwareDevicesSection` (default export, kendi state/handler'larını taşır, yalnız Tauri'de çağrılır).

- [ ] **Step 1: Failing test**

```tsx
// frontend/src/features/branches/__tests__/BranchDetailPage.tabs.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../branchApi', () => ({
  useGetBranch: () => ({ data: { id: 'b1', name: 'Merkez', code: 'M1', timezone: 'Europe/Istanbul' }, isLoading: false, isError: false }),
  useGetHealthOverview: () => ({ data: [] }),
  useUpdateBranch: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../devices/DeviceManagerSection', () => ({ default: () => <div>MESH</div> }));
vi.mock('../BranchNetworkSection', () => ({ default: () => <div>NETWORK</div> }));
vi.mock('../../../pages/settings/PaymentTerminalsSettingsPage', () => ({
  PaymentTerminalsPanel: () => <div>TERMINALS</div>,
}));
vi.mock('../../fiscal/FiscalDevicesPanel', () => ({ FiscalDevicesPanel: () => <div>YAZARKASA</div> }));
vi.mock('../../../store/branchScopeStore', () => ({
  useBranchScopeStore: (sel: (s: { branchId: string }) => unknown) => sel({ branchId: 'b1' }),
}));
vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: () => true, hasIntegration: (d: string) => d === 'fiscal' }),
}));
vi.mock('@/lib/tauri', () => ({ isTauri: () => false, HardwareService: {} }));

import BranchDetailPage from '../BranchDetailPage';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/admin/branches/b1']}>
      <Routes><Route path="/admin/branches/:id" element={<BranchDetailPage />} /></Routes>
    </MemoryRouter>,
  );

describe('BranchDetailPage — cihaz sekmeleri', () => {
  it('aktif şubede Terminaller + Yazarkasa sekmeleri görünür; Donanım (Tauri) web-de gizli', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Ödeme Terminalleri|Payment Terminals/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Yazarkasa|Cash Register/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Donanım|Hardware/ })).toBeNull();
  });
});
```
NOT: mock yolları uygulama sırasında gerçek import yollarına göre düzeltilir (`useGetBranch`/`useGetHealthOverview`'un geldiği modülü `BranchDetailPage.tsx` importlarından oku; test ona göre mock'lar).

- [ ] **Step 2: FAIL gör** — sekmeler yok.

- [ ] **Step 3: Panelleri ayrıştır**

a) `FiscalDevicesPanel` → yeni dosyaya taşı: `FiscalRecoveryPage.tsx`'teki `FiscalDevicesPanel` fonksiyonu (satır 123-234) + kullandığı importlar (`useAuthStore`, `UserRole`, `QueryStateGate`, `useListFiscalDevices`, `useRegisterFiscalDevice`, `useRetireFiscalDevice`, `FiscalDevice` tipi, `useState`, `useTranslation`) AYNEN `frontend/src/features/fiscal/FiscalDevicesPanel.tsx`'e; `export function FiscalDevicesPanel()`. `FiscalRecoveryPage`'ten `<FiscalDevicesPanel />` çağrısı (satır 54) ve taşınan importlar SİLİNİR — Belgeler'de artık YALNIZ kuyruk görünür (spec'teki geçicilik biter).

b) `PaymentTerminalsSettingsPage.tsx` → panel/page ayrımı (InvoicesPanel deseni): bileşen gövdesi `export const PaymentTerminalsPanel = () => { ... }` olur; dıştaki `p-4 md:p-6` sarmalayıcı ve `h1` başlık bloğu panelden ÇIKAR ("Kaydet" düğmesi panel içinde kalır — başlık satırındaki `Button`'ı panelin üstünde `flex justify-end` satırına taşı). Default export SİLİNİR (rota kalkıyor).

c) `HardwareDevicesSection` → `IntegrationsSettingsPage.tsx`'ten Tauri donanım kartı (satır 281-329+ Tabs bloğu) + bağlı state (`deviceConfigModalOpen`, `editingDevice`), handler'lar (`handleEditDevice`, `handleTestDevice`, `handleDeleteIntegration`'ın CİHAZ dalı, `filterDevicesByType`), `DeviceConfigModal`/`HardwareDeviceCard` importları ve donanım listesi sorgusu KENDİ İÇİNE taşınır (`export default function HardwareDevicesSection()`); dosyada kalan entegrasyon listesi bozulmaz. Taşıma sonrası `IntegrationsSettingsPage`'te kullanılmayan import/state kalmadığını `npx tsc --noEmit` doğrular.

- [ ] **Step 4: BranchDetailPage sekmeleri**

```tsx
import { useBranchScopeStore } from '../../store/branchScopeStore';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { PaymentTerminalsPanel } from '../../pages/settings/PaymentTerminalsSettingsPage';
import { FiscalDevicesPanel } from '../fiscal/FiscalDevicesPanel';
import HardwareDevicesSection from '../devices/HardwareDevicesSection';
import { isTauri } from '@/lib/tauri';
import { CreditCard, Printer, HardDrive } from 'lucide-react'; // mevcut Cpu/Router yanına

type Tab = 'devices' | 'terminals' | 'fiscal' | 'hardware' | 'network';
// bileşen içinde:
  const activeBranchId = useBranchScopeStore((s) => s.branchId);
  const { hasIntegration } = useSubscription();
  const isActiveBranch = branch ? activeBranchId === branch.id : false;
```
Sekme çubuğu (mevcut iki TabButton'ın yanına; terminals/fiscal/hardware yalnız `isActiveBranch` iken — panel API'leri X-Branch-Id scope'una yazar, başka şubenin sayfasından YANLIŞ şubeye kayıt yapılmasın; hardware ayrıca `isTauri()`, fiscal ayrıca `hasIntegration('fiscal')` — hide-not-403):
```tsx
        {isActiveBranch && (
          <TabButton active={tab === 'terminals'} onClick={() => setTab('terminals')} icon={CreditCard}>
            {t('hummytummy.branchDetail.tabs.terminals', { defaultValue: 'Ödeme Terminalleri' })}
          </TabButton>
        )}
        {isActiveBranch && hasIntegration('fiscal') && (
          <TabButton active={tab === 'fiscal'} onClick={() => setTab('fiscal')} icon={Printer}>
            {t('hummytummy.branchDetail.tabs.fiscal', { defaultValue: 'Yazarkasa' })}
          </TabButton>
        )}
        {isActiveBranch && isTauri() && (
          <TabButton active={tab === 'hardware'} onClick={() => setTab('hardware')} icon={HardDrive}>
            {t('hummytummy.branchDetail.tabs.hardware', { defaultValue: 'Yazıcı & Çekmece' })}
          </TabButton>
        )}
```
İçerik kartı ternary'den map'e:
```tsx
      <Card variant="bordered" className="p-4 sm:p-5">
        {tab === 'devices' && <DeviceManagerSection branchId={branch.id} />}
        {tab === 'terminals' && <PaymentTerminalsPanel />}
        {tab === 'fiscal' && <FiscalDevicesPanel />}
        {tab === 'hardware' && <HardwareDevicesSection />}
        {tab === 'network' && <BranchNetworkSection branchId={branch.id} />}
      </Card>
```
Aktif olmayan şubede ipucu satırı (sekme çubuğunun altına):
```tsx
      {!isActiveBranch && (
        <p className="text-xs text-slate-500">
          {t('hummytummy.branchDetail.scopeHint', {
            defaultValue: 'Terminal ve yazarkasa yönetimi için üst çubuktan bu şubeye geçin.',
          })}
        </p>
      )}
```
i18n (5 locale, `common.json` `hummytummy.branchDetail.tabs` bloğu + `scopeHint`): tr yukarıdaki değerler; en "Payment Terminals" / "Cash Register" / "Printer & Drawer" / "Switch to this branch in the top bar to manage terminals and the cash register."; ru/ar/uz anlam-koruyan çeviri.

- [ ] **Step 5: Rotalar + SettingsLayout**

`App.tsx` settings nested bloğunda:
```tsx
              {/* Cihaz yönetimi şube hub'ına taşındı (Şubeler → şube → sekmeler). */}
              <Route path="payment-terminals" element={<Navigate to="/admin/branches" replace />} />
              <Route
                path="accounting"
                element={<Navigate to="/admin/finance?group=documents&tab=settings" replace />}
              />
```
Eski `payment-terminals` (706-712) ve FeatureGate'li `accounting` (695-707) blokları SİLİNİR; `PaymentTerminalsSettingsPage` ve `AccountingSettingsPage` lazy def'leri kaldırılır (`AccountingSettingsPanel` named import'u `AccountingBackOfficePage` içinde yaşamaya devam eder — App.tsx'ten bağımsız).
`SettingsLayout.tsx`: `payment-terminals` (satır 32) ve `accounting` (99-103) öğeleri SİLİNİR.

- [ ] **Step 6: PASS + tam suite + commit**

Run: hedef test PASS; `npm run test:ci` tam (PaymentTerminals/Integrations/Settings testleri yeni yapıya göre güncellenir); `npx tsc --noEmit` 0.
```bash
git add -A && git commit -m "feat(devices): consolidate terminals+fiscal+hardware into branch hub, settings routes redirect"
```

---

### Task 7: Raporlar tematik gruplama (Faz 5a)

**Files:**
- Modify: `frontend/src/pages/admin/ReportsPage.tsx`
- Modify: `frontend/src/i18n/locales/{ar,en,ru,tr,uz}/reports.json` (`reports.themes.*`)
- Test: `frontend/src/pages/admin/__tests__/ReportsPage.themes.test.tsx` (yeni)

**Interfaces:**
- Consumes: Task 4 sonrası TabType (zreports'suz 9 sekme).
- Produces: tema katmanı — `type Theme = 'sales' | 'financeBudget' | 'operation'`; `THEME_TABS` haritası.

- [ ] **Step 1: Failing test**

```tsx
// frontend/src/pages/admin/__tests__/ReportsPage.themes.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../../contexts/SubscriptionContext', () => ({
  useSubscription: () => ({ hasFeature: (k: string) => k !== 'inventoryTracking' }),
}));
// Ağır tab gövdelerini mock'la — bu suite yalnız IA'yı doğrular:
vi.mock('../reports/FinanceTab', () => ({ default: () => <div>PNL</div> }));
vi.mock('../reports/AccountingReportsTabs', () => ({
  BudgetTab: () => <div>BUDGET</div>, ConsolidatedTab: () => <div>CONS</div>, ForecastTab: () => <div>FORECAST</div>,
}));
// (satış/saatlik/müşteri bileşen mock'ları — uygulama sırasında gerçek import adlarına göre tamamla)

import ReportsPage from '../ReportsPage';

describe('ReportsPage — tema grupları', () => {
  it('3 tema pill; Finans & Bütçe teması P&L/Bütçe/Konsolide sekmelerini gösterir', () => {
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Finans & Bütçe|Finance & Budget/ }));
    expect(screen.getByRole('button', { name: /Kâr-Zarar|P&L|Profit/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Satış Raporu|Sales Report/ })).toBeNull();
  });
  it('feature-gizleme tema içinde çalışır (inventory yokken Operasyon envanter sekmesiz)', () => {
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Operasyon|Operations/ }));
    expect(screen.queryByRole('button', { name: /Envanter|Inventory/ })).toBeNull();
  });
});
```

- [ ] **Step 2: FAIL gör.**

- [ ] **Step 3: Tema katmanını uygula**

`ReportsPage.tsx`:
```tsx
type Theme = 'sales' | 'financeBudget' | 'operation';
const THEME_TABS: Record<Theme, TabType[]> = {
  sales: ['sales', 'forecast', 'hourly'],
  financeBudget: ['finance', 'budget', 'consolidated'],
  operation: ['customers', 'inventory', 'staff'],
};
// state:
  const [theme, setTheme] = useState<Theme>('sales');
// mevcut feature-filtreli `tabs`ın üstüne tema filtresi:
  const themeTabs = tabs.filter((tb) => THEME_TABS[theme].includes(tb.id));
// tema değişince ilk görünür sekmeye geç:
  const switchTheme = (th: Theme) => {
    setTheme(th);
    const first = tabs.find((tb) => THEME_TABS[th].includes(tb.id));
    if (first) setActiveTab(first.id);
  };
```
Render: mevcut sekme şeridinin ÜSTÜNE tema pill'leri (StockPage pill markup'ı aynen: `inline-flex rounded-xl bg-slate-100 p-1` + aktif `bg-white … shadow-sm`), etiketler `t('reports.themes.sales', 'Satış')`, `t('reports.themes.financeBudget', 'Finans & Bütçe')`, `t('reports.themes.operation', 'Operasyon')`; sekme şeridi `tabs.map` → `themeTabs.map`. Boş tema pill'i gizle: `const themes = (['sales','financeBudget','operation'] as Theme[]).filter((th) => tabs.some((tb) => THEME_TABS[th].includes(tb.id)));`
Fallback düzeltmeleri aynı commit'te: `t('reports.consolidated', 'Konsolide P&L')` → fallback `'Tüm Şubeler Kâr-Zarar'`; Task 4'te zreports zaten çıktı.
i18n `reports.themes.*` (5 locale): tr Satış / Finans & Bütçe / Operasyon; en Sales / Finance & Budget / Operations; ru Продажи / Финансы и бюджет / Операции; ar المبيعات / المالية والميزانية / العمليات; uz Savdo / Moliya va byudjet / Operatsiyalar.

- [ ] **Step 4: PASS + commit**

```bash
git add -A && git commit -m "feat(reports): thematic report groups (sales / finance-budget / operations)"
```

---

### Task 8: Jargon süpürmesi + gating tutarlılığı (Faz 5b)

**Files:**
- Modify: `frontend/src/i18n/locales/{ar,en,ru,tr,uz}/reports.json` + `settings.json` (değer değişimleri)
- Modify: `frontend/src/pages/admin/CostingPage.tsx` (menü mühendisliği sekme-gizleme)
- Modify: `frontend/src/pages/settings/IntegrationsSettingsPage.tsx` (comingSoon "Ekle" gizle)
- Test: mevcut suite (değer değişimleri snapshot kırabilir)

**Interfaces:** — (yalnız değer/gizleme değişiklikleri; yeni API yok)

- [ ] **Step 1: Locale değer değişimleri (5 locale'de aynı anahtarlar, dil-uygun değerle)**

`reports.json` (tr değerleri; en/ru/ar/uz aynı anlamla güncellenir):
- `finance.cogs`: `"SMM (COGS)"` → `"Malzeme Maliyeti"`
- `finance.primeCost`: `"Prime Cost (SMM+İşçilik)"` → `"Malzeme + İşçilik Maliyeti"`
- `budget.title` ve `reports.budget`: `"Bütçe vs Fiili"` → `"Bütçe Karşılaştırması"`
- `budget.varianceLabel`: `"varyans"` → `"fark"`; `budget.headVariance`: `"Varyans"` → `"Fark"`
- `consolidated.title` ve `reports.consolidated`: `"Konsolide Kâr-Zarar"` → `"Tüm Şubeler Kâr-Zarar"`
- `consolidated.forbidden`: `"Konsolide P&L yalnızca…"` → `"Tüm şubeler kâr-zarar raporu yalnızca tüm şubelere erişimi olan yöneticiler içindir."`
- `costing.subtitle`: `"Menü mühendisliği (Star/Plowhorse/Puzzle/Dog), teorik-fiili varyans ve reçete başı maliyet."` → `"Menü kârlılık analizi, planlanan-gerçekleşen kullanım farkı ve reçete başı maliyet."`
- `costing.tabMenu` / `costing.menuTitle`: `"Menü Mühendisliği"` → `"Menü Kârlılığı"`

`settings.json`:
- `accounting.backoffice.resyncTitle` içindeki `"Reddedilen (FAILED)…"` kalıbı → tr `"Gönderilemeyen belgeleri yeniden gönder"` (en "Resend undelivered documents", diğerleri anlamca).
- "entegratör" geçen açıklama değerleri (grep: `grep -n "entegratör" frontend/src/i18n/locales/tr/settings.json`) → `"e-Belge sağlayıcı bağlantısı"` ifadesiyle yeniden yazılır; alan adları (`Client ID` vb.) parantez içinde teknik adıyla kalır.
- İade onay metnindeki çift tekrar (`"…iade faturası (İade Faturası)…"`, settings.json:628 civarı) → tekilleştir.

- [ ] **Step 2: CostingPage gate uyumu**

`CostingPage.tsx`'te menü-mühendisliği sekmesi (`tabMenu`) `hasFeature('advancedReports')` yoksa upsell metni yerine SEKME GİZLENİR (ReportsPage `allTabs.filter` deseni; `costing.upgradeRequired` upsell dalı silinir). Varsayılan sekme, gizlenince ilk görünür sekmeye düşer.

- [ ] **Step 3: Entegrasyonlar "Ekle" comingSoon**

`IntegrationsSettingsPage.tsx`: `comingSoon` toast atan "Ekle" düğmesi (satır ~409-415) — düğme yalnız gerçekten eklenebilir sağlayıcı varken render edilir; yoksa düğme YOK (toast'lı çıkmaz kaldırılır).

- [ ] **Step 4: Doğrula + commit**

Run: `npm run test:ci` tam (etiket bekleyen testler yeni değerlerle güncellenir); `node scripts/check-i18n-parity.mjs` + `--gate-new` value-drift → 0.
Jargon süpürme grep'i (kalan çıplak jargon var mı):
```bash
grep -rn "SAFE_DROP\|X-Report\|Petty\|vendor SDK\|Konsolide P&L" frontend/src --include="*.tsx" --include="*.json" | grep -v ".test." | grep -v "value=\"SAFE_DROP\""
```
Expected: 0 satır (select `value` enum'ları hariç — onlar backend sözleşmesi).
```bash
git add -A && git commit -m "refactor(i18n): plain-language finance/report labels, align costing gate, drop coming-soon dead button"
```

---

### Task 9: Uçtan uca doğrulama

**Files:** — (değişiklik yok; yalnız doğrulama + gerekirse düzeltme commit'leri)

- [ ] **Step 1: Tam kapı seti**

```bash
cd /home/tarik/Projects/kds-finance/frontend
npx tsc --noEmit          # Expected: 0 hata
npm run lint              # Expected: 0 error (uyarı ≤ 200)
npm run test:ci           # Expected: tüm testler PASS
npm run build             # Expected: build başarılı
cd .. && node scripts/check-i18n-parity.mjs && node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json
```

- [ ] **Step 2: Elle akış doğrulaması (dev server)**

`/admin/finance` → Genel Bakış varsayılan, kartlar geliyor; Kasa → 4 sekme (Vardiyalar/Kasa Hareketleri/Gün Sonu/Bahşiş-planlıysa); Belgeler → Faturalar/Gönderilemeyenler & Durum/Ayarlar. Eski 6 rota (`/admin/cash`, `/admin/accounting-backoffice`, `/admin/invoices`, `/admin/fiscal-recovery`, `/admin/settings/payment-terminals`, `/admin/settings/accounting`) redirect ediyor. Sidebar'da tek Finans; Ayarlar nav'ında terminal/muhasebe yok. Şube detayında (aktif şube) Terminaller/Yazarkasa sekmeleri; başka şubede scope ipucu. Raporlar'da 3 tema.

- [ ] **Step 3: Push + PR (worktree'den)**

```bash
bash /home/tarik/Projects/kds/scripts/push-via-openssl.sh feat/finance-consolidation
gh pr create --base main --head feat/finance-consolidation --title "feat: Finans konsolidasyonu + cihaz birleşimi + rapor sadeleşmesi" --body "<özet — spec: docs/superpowers/specs/2026-07-21-finance-consolidation-design.md>"
```
PR gövdesinde AI izi YOK. NOT: taban `feat/dashboard-redesign` üstüne stack'li — dashboard PR'ı merge olmadan bu PR onun commit'lerini de gösterir; PR açıklamasına yaz, merge SIRASI: önce dashboard.

---

## Self-Review Notları (plan yazarı doldurdu)

- **Spec kapsaması:** §3.1→T1, §3.2 Genel Bakış→T3 / Kasa→T4+T5 / Belgeler→T2, §3.3 gating→T1(rota)+T5(Bahşiş)+T3(upsell)+T6(apiAccess/settings), §3.4→T7 (+T4 zreports), §3.5→T6, §3.6→T1+T6, §4 jargon→T5+T8, §7 ölü sayfa→T4. Boşluk yok.
- **Bilinen riskler:** (1) BranchDetailPage API modül yolları testte tahmini — uygulayıcı gerçek importlara göre düzeltir (T6 notu). (2) `useQueries` mock'u T3 testinde kaba — gerçek anahtar yapısı `['cash','x-report',id]` ile uyumlu tutuldu. (3) Padding çifti T1 Step 8 elle doğrulanır. (4) ru/ar/uz çeviriler uygulayıcıya bırakılan yerlerde value-drift gate'i İngilizce-placeholder'ı yakalar.

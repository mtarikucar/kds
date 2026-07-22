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
// Satış/saatlik/müşteri/envanter/personel bileşenleri — gerçek import adları:
vi.mock('../../../components/reports/HourlyOrdersChart', () => ({ default: () => <div>HOURLY</div> }));
vi.mock('../../../components/reports/CustomerAnalyticsSection', () => ({ default: () => <div>CUSTOMERS</div> }));
vi.mock('../../../components/reports/InventorySection', () => ({ default: () => <div>INVENTORY</div> }));
vi.mock('../../../components/reports/StaffPerformanceSection', () => ({ default: () => <div>STAFF</div> }));
// ReportsPage'in kendisi (sales sekmesi) react-query hook'larını doğrudan
// çağırıyor — QueryClientProvider'sız render için tamamen mock'la.
vi.mock('../../../features/reports/reportsApi', () => ({
  useSalesReport: () => ({ data: undefined, isLoading: false }),
  useTopProducts: () => ({ data: undefined, isLoading: false }),
  useSalesComparison: () => ({ data: undefined }),
  metricTrend: () => undefined,
  downloadSalesCsv: vi.fn(),
}));
vi.mock('../../../features/branches/branchesApi', () => ({
  useListBranches: () => ({ data: [] }),
}));
// useFormatCurrency -> useCurrency chains into react-query too.
vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => 'TRY',
}));

import ReportsPage from '../ReportsPage';

describe('ReportsPage — tema grupları', () => {
  it('3 tema pill; Finans & Bütçe teması P&L/Bütçe/Konsolide sekmelerini gösterir', () => {
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Finans & Bütçe|Finance & Budget/ }));
    // finance/consolidated fallback'ları her ikisi de "Kâr-Zarar" içerir —
    // tek tek eşleşen buton sayısını doğrula (belirsiz eşleşmeyi önlemek için).
    expect(screen.getByRole('button', { name: /Finans \(Kâr-Zarar\)|Finance \(P&L\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Bütçe Karşılaştırması|Budget Comparison/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tüm Şubeler Kâr-Zarar|Consolidated P&L/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Satış Raporu|Sales Report/ })).toBeNull();
  });
  it('feature-gizleme tema içinde çalışır (inventory yokken Operasyon envanter sekmesiz)', () => {
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Operasyon|Operations/ }));
    expect(screen.queryByRole('button', { name: /Envanter|Inventory/ })).toBeNull();
  });
  it('tema değişince o temanın ilk görünür sekmesi aktif olur', () => {
    render(<ReportsPage />);
    fireEvent.click(screen.getByRole('button', { name: /Finans & Bütçe|Finance & Budget/ }));
    expect(screen.getByText('PNL')).toBeTruthy();
  });
  it('varsayılan tema Satış: sales sekmesi görünür, finance/budget/consolidated görünmez', () => {
    render(<ReportsPage />);
    // 'reports.sales' kodda fallback'sız çağrılıyor (t() ikinci argümansız) —
    // bu test ortamında 'reports' namespace'i yüklenmediği için ham anahtar
    // döner (bkz. CostingPage.menu-gate.test.tsx'teki aynı desen); üretimde
    // gerçek çeviri (Satış Raporu / Sales Report) gösterilir.
    expect(
      screen.getByRole('button', { name: /Satış Raporu|Sales Report|reports\.sales/ }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Finans \(Kâr-Zarar\)|Finance \(P&L\)/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Bütçe Karşılaştırması|Budget Comparison/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Tüm Şubeler Kâr-Zarar|Consolidated P&L/ })).toBeNull();
  });
});

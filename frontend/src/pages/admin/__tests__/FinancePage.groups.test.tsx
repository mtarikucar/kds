import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FinancePage from '../FinancePage';

vi.mock('../CashPage', () => ({ default: () => <div>KASA-PANEL</div> }));
vi.mock('../AccountingBackOfficePage', () => ({ default: () => <div>BELGE-PANEL</div> }));
vi.mock('../finance/FinanceOverview', () => ({ default: () => <div>GENEL-BAKIS</div> }));

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <FinancePage />
    </MemoryRouter>,
  );

describe('FinancePage — grup anahtarı', () => {
  it('varsayılan grup Genel Bakış; Kasa pill ile geçilir', () => {
    renderAt('/admin/finance');
    expect(screen.getByText('GENEL-BAKIS')).toBeTruthy();
    expect(screen.queryByText('KASA-PANEL')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Cash|Kasa/ }));
    expect(screen.getByText('KASA-PANEL')).toBeTruthy();
  });

  it('?group=cash ile Kasa açılır', () => {
    renderAt('/admin/finance?group=cash');
    expect(screen.getByText('KASA-PANEL')).toBeTruthy();
  });

  it('?group=documents ile Belgeler açılır', () => {
    renderAt('/admin/finance?group=documents');
    expect(screen.getByText('BELGE-PANEL')).toBeTruthy();
  });

  it('geçersiz group paramı Genel Bakış\'a düşer', () => {
    renderAt('/admin/finance?group=zzz');
    expect(screen.getByText('GENEL-BAKIS')).toBeTruthy();
  });
});

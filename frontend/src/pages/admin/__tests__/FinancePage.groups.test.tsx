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

import {
  PaymentMethod,
  MEAL_VOUCHER_METHODS,
  isMealVoucher,
} from './order-status.enum';

describe('meal-voucher tender taxonomy', () => {
  it('recognises the TR meal-voucher providers as first-class tenders', () => {
    for (const m of ['MULTINET', 'SODEXO', 'EDENRED', 'SETCARD', 'METROPOL']) {
      expect(isMealVoucher(m)).toBe(true);
      expect(MEAL_VOUCHER_METHODS).toContain(m as PaymentMethod);
    }
  });

  it('does not treat cash/card/house as meal vouchers', () => {
    expect(isMealVoucher('CASH')).toBe(false);
    expect(isMealVoucher('CARD')).toBe(false);
    expect(isMealVoucher('HOUSE')).toBe(false);
    expect(isMealVoucher('')).toBe(false);
  });
});

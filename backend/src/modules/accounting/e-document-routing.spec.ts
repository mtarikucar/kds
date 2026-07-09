import {
  resolveEDocumentType,
  validateBuyerFor,
  isValidTaxId,
} from './e-document-routing';

describe('e-document routing (GİB)', () => {
  describe('resolveEDocumentType', () => {
    it('routes a registered e-Fatura buyer with a valid VKN to EFATURA', () => {
      expect(
        resolveEDocumentType({ taxId: '1234567890', taxOffice: 'Kadıköy', isRegisteredEFaturaUser: true }),
      ).toBe('EFATURA');
    });

    it('routes a final consumer (not registered) to EARSIVFATURA', () => {
      expect(resolveEDocumentType({ isRegisteredEFaturaUser: false })).toBe('EARSIVFATURA');
      expect(resolveEDocumentType({})).toBe('EARSIVFATURA');
    });

    it('falls back to e-Arşiv when registration is unknown even with a VKN (safe default)', () => {
      // No integrator query run → never wrongly issue a B2B e-Fatura.
      expect(
        resolveEDocumentType({ taxId: '1234567890', isRegisteredEFaturaUser: null }),
      ).toBe('EARSIVFATURA');
    });

    it('does not issue e-Fatura to a registered user without a valid tax id', () => {
      expect(
        resolveEDocumentType({ taxId: '123', isRegisteredEFaturaUser: true }),
      ).toBe('EARSIVFATURA');
    });
  });

  describe('isValidTaxId', () => {
    it('accepts a 10-digit VKN and 11-digit TCKN, rejects the rest', () => {
      expect(isValidTaxId('1234567890')).toBe(true);
      expect(isValidTaxId('12345678901')).toBe(true);
      expect(isValidTaxId('12345')).toBe(false);
      expect(isValidTaxId('12345678AB')).toBe(false);
      expect(isValidTaxId(null)).toBe(false);
    });
  });

  describe('validateBuyerFor', () => {
    it('requires VKN + tax office for e-Fatura', () => {
      expect(validateBuyerFor('EFATURA', {})).toEqual([
        'e-Fatura requires a valid buyer VKN (10) / TCKN (11)',
        'e-Fatura requires the buyer tax office (vergi dairesi)',
      ]);
      expect(
        validateBuyerFor('EFATURA', { taxId: '1234567890', taxOffice: 'Beşiktaş' }),
      ).toEqual([]);
    });

    it('imposes no buyer requirements for e-Arşiv (B2C)', () => {
      expect(validateBuyerFor('EARSIVFATURA', {})).toEqual([]);
    });
  });
});

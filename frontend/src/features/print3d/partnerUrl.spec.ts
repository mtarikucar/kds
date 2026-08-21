import { describe, it, expect } from 'vitest';
import { safePartnerUrl } from './partnerUrl';

describe('safePartnerUrl', () => {
  it('accepts https and http', () => {
    expect(safePartnerUrl('https://figurunica.com')).toBe('https://figurunica.com');
    expect(safePartnerUrl('http://figurunica.com')).toBe('http://figurunica.com');
  });

  it('rejects javascript:, protocol-relative and empty values', () => {
    // Sunucu da aynı testi yapıyor; bu ikinci kemer, sunucu yanıtı bir gün
    // başka bir yerden gelirse rozetin XSS taşımaması için.
    expect(safePartnerUrl('javascript:alert(1)')).toBeNull();
    expect(safePartnerUrl('//evil.example')).toBeNull();
    expect(safePartnerUrl('')).toBeNull();
    expect(safePartnerUrl(null)).toBeNull();
    expect(safePartnerUrl(undefined)).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { formatAddress } from './formatAddress';
import type { ShippingAddress } from './storeApi';

/**
 * Unit spec for the extracted formatAddress helper (was module-private in
 * HardwareOrderDetailPage v2.8.84). Asserts both the free-text and
 * structured-address branches plus the line-omission / district-join rules.
 */
describe('formatAddress', () => {
  it('splits a free-text string on newlines and trims, dropping blanks', () => {
    const raw = '  Line one  \r\nLine two\n\n   \nLine three  ';
    expect(formatAddress(raw)).toEqual(['Line one', 'Line two', 'Line three']);
  });

  it('renders a full structured address line-by-line', () => {
    const addr: ShippingAddress = {
      recipientName: 'Ada Lovelace',
      phone: '+90 555 000 0000',
      line1: 'Bağdat Cad. 12',
      line2: 'Kat 3 Daire 5',
      district: 'Kadıköy',
      city: 'İstanbul',
      postalCode: '34710',
      country: 'Türkiye',
    };
    expect(formatAddress(addr)).toEqual([
      'Ada Lovelace',
      'Bağdat Cad. 12',
      'Kat 3 Daire 5',
      'Kadıköy, İstanbul',
      '34710',
      'Türkiye',
      '+90 555 000 0000',
    ]);
  });

  it('joins district + city on one line, joining only present parts', () => {
    const onlyCity: ShippingAddress = {
      recipientName: 'X',
      phone: '1',
      line1: 'L1',
      city: 'İzmir',
      country: 'TR',
    };
    // district omitted -> the district/city line is just the city
    expect(formatAddress(onlyCity)).toEqual(['X', 'L1', 'İzmir', 'TR', '1']);
  });

  it('omits empty / whitespace-only structured fields', () => {
    const addr: ShippingAddress = {
      recipientName: '   ',
      phone: '',
      line1: 'Only line',
      line2: undefined,
      district: undefined,
      city: 'Ankara',
      postalCode: undefined,
      country: '  ',
    };
    expect(formatAddress(addr)).toEqual(['Only line', 'Ankara']);
  });
});

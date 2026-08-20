import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const getMock = vi.fn();
vi.mock('../lib/api', () => ({
  default: {
    get: (...args: unknown[]) => getMock(...args),
    patch: vi.fn(),
  },
}));

import { useCountryProfile, isValidTaxId, taxIdMaxLength } from './useCountryProfile';

const TR_RULES = [
  { name: 'VKN', pattern: '^\\d{10}$', labelKey: 'country.taxId.vkn' },
  { name: 'TCKN', pattern: '^\\d{11}$', labelKey: 'country.taxId.tckn' },
];
const UZ_RULES = [
  { name: 'STIR', pattern: '^\\d{9}$', labelKey: 'country.taxId.stir' },
  { name: 'PINFL', pattern: '^\\d{14}$', labelKey: 'country.taxId.pinfl' },
];

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useCountryProfile', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('falls back to the Turkish band before settings load (deliberate — todays existing behaviour)', () => {
    getMock.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useCountryProfile(), { wrapper });
    expect(result.current).toEqual({
      countryCode: 'TR',
      currency: 'TRY',
      displayDecimals: 2,
      taxRates: [0, 1, 10, 20],
      defaultTaxRate: 10,
      taxIdRules: TR_RULES,
    });
  });

  it('surfaces the TR profile once settings load for a TR tenant', async () => {
    getMock.mockResolvedValue({
      data: {
        id: 't1',
        countryCode: 'TR',
        currency: 'TRY',
        displayDecimals: 2,
        taxRates: [0, 1, 10, 20],
        defaultTaxRate: 10,
        taxIdRules: TR_RULES,
      },
    });
    const { result } = renderHook(() => useCountryProfile(), { wrapper });
    await waitFor(() => expect(result.current.countryCode).toBe('TR'));
    expect(result.current.currency).toBe('TRY');
    expect(result.current.displayDecimals).toBe(2);
    expect(result.current.taxRates).toEqual([0, 1, 10, 20]);
    expect(result.current.defaultTaxRate).toBe(10);
    expect(result.current.taxIdRules).toEqual(TR_RULES);
  });

  it("surfaces the UZ tenant's OWN band (0/6/12) and currency (UZS, zero decimals), not Turkey's", async () => {
    getMock.mockResolvedValue({
      data: {
        id: 't2',
        countryCode: 'UZ',
        currency: 'UZS',
        displayDecimals: 0,
        taxRates: [0, 6, 12],
        defaultTaxRate: 12,
        taxIdRules: UZ_RULES,
      },
    });
    const { result } = renderHook(() => useCountryProfile(), { wrapper });
    await waitFor(() => expect(result.current.countryCode).toBe('UZ'));
    expect(result.current.currency).toBe('UZS');
    expect(result.current.displayDecimals).toBe(0);
    expect(result.current.taxRates).toEqual([0, 6, 12]);
    expect(result.current.defaultTaxRate).toBe(12);
    expect(result.current.taxIdRules).toEqual(UZ_RULES);
  });
});

describe('isValidTaxId', () => {
  it('TR accepts VKN(10) and TCKN(11), rejects the Uzbek shapes', () => {
    expect(isValidTaxId('1234567890', TR_RULES)).toBe(true);
    expect(isValidTaxId('12345678901', TR_RULES)).toBe(true);
    expect(isValidTaxId('123456789', TR_RULES)).toBe(false);
  });

  it('UZ accepts STIR(9) and PINFL(14), rejects the Turkish shapes', () => {
    expect(isValidTaxId('123456789', UZ_RULES)).toBe(true);
    expect(isValidTaxId('12345678901234', UZ_RULES)).toBe(true);
    expect(isValidTaxId('1234567890', UZ_RULES)).toBe(false);
  });

  it('rejects non-digits and empty regardless of rules', () => {
    expect(isValidTaxId('abc', TR_RULES)).toBe(false);
    expect(isValidTaxId('', UZ_RULES)).toBe(false);
  });
});

describe('taxIdMaxLength', () => {
  it('is the longest digit-count among TR rules (11, from TCKN)', () => {
    expect(taxIdMaxLength(TR_RULES)).toBe(11);
  });

  it('is the longest digit-count among UZ rules (14, from PINFL)', () => {
    expect(taxIdMaxLength(UZ_RULES)).toBe(14);
  });
});

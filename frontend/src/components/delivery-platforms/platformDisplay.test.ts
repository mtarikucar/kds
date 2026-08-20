import { describe, it, expect } from 'vitest';
import {
  PLATFORM_DISPLAY,
  ORDERABLE_PLATFORM_KEYS,
  getPlatformDisplay,
} from './platformDisplay';

describe('platformDisplay', () => {
  it('brands Semt instead of falling back to slate', () => {
    // The fallback already keeps the KDS/POS badge from crashing, but a
    // Semt-tagged order should read as Semt, not as an unrecognised source.
    expect(PLATFORM_DISPLAY.SEMT).toBeDefined();
    expect(getPlatformDisplay('SEMT').label).toBe('Semt');
    expect(getPlatformDisplay('SEMT').className).toContain('sky');
  });

  it('keeps a coming-soon platform out of the POS filter chips', () => {
    // A Semt chip can never match an order: no adapter, no webhook route. It
    // would sit in the delivery inbox permanently empty. The badge map still
    // needs the entry, so the filtering happens here, not by omission.
    expect(Object.keys(PLATFORM_DISPLAY)).toContain('SEMT');
    expect(ORDERABLE_PLATFORM_KEYS).not.toContain('SEMT');
    expect(ORDERABLE_PLATFORM_KEYS).toEqual([
      'YEMEKSEPETI',
      'GETIR',
      'TRENDYOL',
      'MIGROS',
    ]);
  });
});

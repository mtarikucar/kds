import { describe, it, expect } from 'vitest';
import { CheckCircle, XCircle, Clock } from 'lucide-react';
import { TableStatus } from '../types';
import {
  tableStatusConfig,
  getTableStatusConfig,
  getTableStatusLabel,
} from './tableStatus';

describe('tableStatusConfig', () => {
  it('defines an entry for every TableStatus', () => {
    Object.values(TableStatus).forEach((status) => {
      expect(tableStatusConfig[status]).toBeDefined();
    });
  });

  it('standardizes the palette: available=emerald, occupied=red, reserved=amber', () => {
    expect(tableStatusConfig[TableStatus.AVAILABLE].accent).toBe('emerald');
    expect(tableStatusConfig[TableStatus.OCCUPIED].accent).toBe('red');
    expect(tableStatusConfig[TableStatus.RESERVED].accent).toBe('amber');
  });

  it('maps each status to the matching Badge variant', () => {
    expect(tableStatusConfig[TableStatus.AVAILABLE].variant).toBe('success');
    expect(tableStatusConfig[TableStatus.OCCUPIED].variant).toBe('danger');
    expect(tableStatusConfig[TableStatus.RESERVED].variant).toBe('warning');
  });

  it('assigns the expected icon per status', () => {
    expect(tableStatusConfig[TableStatus.AVAILABLE].icon).toBe(CheckCircle);
    expect(tableStatusConfig[TableStatus.OCCUPIED].icon).toBe(XCircle);
    expect(tableStatusConfig[TableStatus.RESERVED].icon).toBe(Clock);
  });

  it('chip classes carry the matching colour family', () => {
    expect(tableStatusConfig[TableStatus.AVAILABLE].chip).toContain('emerald');
    expect(tableStatusConfig[TableStatus.OCCUPIED].chip).toContain('red');
    expect(tableStatusConfig[TableStatus.RESERVED].chip).toContain('amber');
  });
});

describe('getTableStatusConfig', () => {
  it('returns the entry for a known status', () => {
    expect(getTableStatusConfig(TableStatus.RESERVED)).toBe(
      tableStatusConfig[TableStatus.RESERVED],
    );
  });

  it('falls back to AVAILABLE for an unknown/legacy status string', () => {
    expect(getTableStatusConfig('SOMETHING_WEIRD')).toBe(
      tableStatusConfig[TableStatus.AVAILABLE],
    );
  });
});

describe('getTableStatusLabel', () => {
  const t = (key: string, def?: string) => `${key}|${def ?? ''}`;

  it('uses the config label key by default', () => {
    expect(getTableStatusLabel(TableStatus.OCCUPIED, t)).toBe(
      'admin.occupied|Dolu',
    );
  });

  it('honours a key override (e.g. POS grid namespace)', () => {
    expect(
      getTableStatusLabel(TableStatus.RESERVED, t, 'tableGrid.status.RESERVED'),
    ).toBe('tableGrid.status.RESERVED|Rezerve');
  });

  it('supplies a Turkish default for the customer picker (reserved was missing)', () => {
    // simulate a t that has no translation and returns the default
    const tMissing = (_key: string, def?: string) => def ?? _key;
    expect(
      getTableStatusLabel(TableStatus.RESERVED, tMissing, 'tableSelection.reserved'),
    ).toBe('Rezerve');
  });
});

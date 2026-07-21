import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TABLE_VIEW,
  TABLE_VIEW_MODES,
  parseTableViewMode,
  serializeTableViewMode,
} from './tableViewMode';

describe('parseTableViewMode', () => {
  it('accepts every known mode', () => {
    for (const mode of TABLE_VIEW_MODES) {
      expect(parseTableViewMode(mode)).toBe(mode);
    }
  });

  it('falls back to the default for an absent param', () => {
    expect(parseTableViewMode(null)).toBe(DEFAULT_TABLE_VIEW);
    expect(parseTableViewMode(undefined)).toBe(DEFAULT_TABLE_VIEW);
    expect(parseTableViewMode('')).toBe(DEFAULT_TABLE_VIEW);
  });

  it('falls back to the default for garbage/casing mismatches', () => {
    expect(parseTableViewMode('map')).toBe(DEFAULT_TABLE_VIEW);
    expect(parseTableViewMode('PLAN')).toBe(DEFAULT_TABLE_VIEW);
    expect(parseTableViewMode('edit ')).toBe(DEFAULT_TABLE_VIEW);
    expect(parseTableViewMode('list;drop')).toBe(DEFAULT_TABLE_VIEW);
  });
});

describe('serializeTableViewMode', () => {
  it('drops the param for the default mode', () => {
    expect(serializeTableViewMode(DEFAULT_TABLE_VIEW)).toBeNull();
  });

  it('serializes non-default modes verbatim', () => {
    expect(serializeTableViewMode('edit')).toBe('edit');
    expect(serializeTableViewMode('list')).toBe('list');
  });

  it('round-trips every mode through parse', () => {
    for (const mode of TABLE_VIEW_MODES) {
      expect(parseTableViewMode(serializeTableViewMode(mode))).toBe(mode);
    }
  });
});

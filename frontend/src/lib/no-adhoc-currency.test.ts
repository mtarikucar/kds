import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Money formatting has been fixed one screen at a time three times now: the QR
 * menu, then the admin rail, then the billing helper — each time because a
 * screen built its own Intl formatter instead of asking the shared one. The
 * symbol and precision table in lib/utils is only the single source of truth if
 * nothing routes around it, and a UZS tenant is what exposes a screen that does
 * (it renders "UZS 50.000" instead of "50.000 so'm").
 *
 * So this is a structural guard, not a behaviour test: any NEW hand-rolled
 * currency formatter fails here and is pointed at formatCurrency().
 */
const RAILS = [
  'src/lib/utils.ts',
  'src/lib/currency.ts',
  'src/hooks/useFormatCurrency.ts',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

describe('currency formatting has exactly one source of truth', () => {
  it('has no hand-rolled currency formatter outside the three rails', () => {
    const offenders = walk('src')
      .filter((f) => !RAILS.some((r) => f.endsWith(r.replace('src/', 'src/'))))
      .filter((f) => /style:\s*['"]currency['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(/\\/g, '/'));

    expect(offenders, `use formatCurrency() from lib/utils instead:\n${offenders.join('\n')}`).toEqual([]);
  });
});

import * as fs from 'fs';
import * as path from 'path';

/**
 * Architecture-fitness test for the marketing↔core decoupling (Phase 5 split
 * readiness). These assertions are the invariants that make the eventual
 * physical split mechanical — they fail loudly if a change re-couples the
 * contexts. CI-independent (does not rely on the ESLint boundary rule).
 */
const BACKEND_ROOT = path.resolve(__dirname, '../../..');
const MARKETING_DIR = path.join(BACKEND_ROOT, 'src/modules/marketing');
const SCHEMA = path.join(BACKEND_ROOT, 'prisma/schema.prisma');

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('marketing decoupling — split readiness (architecture fitness)', () => {
  it('drops the 4 cross-context FK relations from the schema, keeping soft-ref columns', () => {
    const schema = fs.readFileSync(SCHEMA, 'utf8');

    // Forward + back relations of the 4 cross-context FKs must be gone.
    expect(schema).not.toMatch(/convertedTenant\s+Tenant\?\s+@relation/);
    expect(schema).not.toMatch(/@relation\("ConvertedTenant"/);
    expect(schema).not.toMatch(/@relation\("MarketingCommissions"/);
    expect(schema).not.toMatch(/plan\s+SubscriptionPlan\?\s+@relation/);
    expect(schema).not.toMatch(/@relation\("ReferredByMarketer"/);

    // The soft-reference columns (the human-meaningful link) are retained.
    expect(schema).toMatch(/convertedTenantId\s+String\?/);
    expect(schema).toMatch(/referredByMarketingUserId\s+String\?/);
    expect(schema).toMatch(/referralCode\s+String\?/);
  });

  it('keeps marketing free of every core Prisma delegate (no cross-context table access)', () => {
    // Mirrors the ESLint boundary rule, asserted here as a committed guarantee.
    const forbidden =
      /\b(?:this\.prisma|tx)\.(tenant|user|subscription|subscriptionPlan|subscriptionPayment|contactMessage)\b/;
    const offenders: string[] = [];
    for (const file of walkTs(MARKETING_DIR)) {
      if (forbidden.test(fs.readFileSync(file, 'utf8'))) {
        offenders.push(path.relative(BACKEND_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('routes the 2 business events through the contracts, not direct cross-imports', () => {
    // Marketing must not import a core implementation directly — only the
    // neutral core-contracts (ports) or the outbox event bus.
    const badImport = /from ['"][^'"]*modules\/(payments|subscriptions|tenants|auth)\//;
    const offenders: string[] = [];
    for (const file of walkTs(MARKETING_DIR)) {
      const src = fs.readFileSync(file, 'utf8');
      if (badImport.test(src)) offenders.push(path.relative(BACKEND_ROOT, file));
    }
    expect(offenders).toEqual([]);
  });
});

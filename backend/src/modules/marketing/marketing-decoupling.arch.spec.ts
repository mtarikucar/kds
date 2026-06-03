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

  /**
   * v3.0.1 round-4 audit fix — symmetric boundary guard. Phase 5's
   * pre-existing tests only catch marketing → core leaks (the
   * direction the decoupling tightens). But the same physical-split
   * goal requires the inverse: CORE must not directly write
   * marketing-owned tables. Pre-fix `catalog.service.ts:requestQuote`
   * called `this.prisma.lead.create` from inside the catalog module,
   * which is a Phase-5-violating leak the marketing arch test could
   * not see because the offender lives outside `modules/marketing/`.
   *
   * The exemption set is narrow on purpose: only the explicit
   * decoupling seams are allowed (the marketing module's own files,
   * the provisioning module that bridges via CoreProvisioningPort, and
   * the superadmin marketing surface that reads marketing tables for
   * tenant-ops dashboards). Any new offender lands on a regression
   * here, not in a future production runbook.
   */
  it('blocks core modules from writing marketing-owned tables (symmetric guard)', () => {
    const SRC_ROOT = path.join(BACKEND_ROOT, 'src');
    // Marketing-owned Prisma delegates. Reads are tolerated (reports,
    // superadmin dashboards) — writes are the leak we're chasing.
    const forbidden =
      /\b(?:this\.prisma|tx|prisma)\.(lead|leadOffer|leadActivity|marketingUser|marketingTask|marketingNotification|commission|installationCrew|installationJob|installationTask|salesCall|salesTarget|marketingDistributionConfig)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/;
    // Files allowed to write these tables: marketing itself, the
    // provisioning bridge, and the superadmin marketing surface.
    const allowPath = /(\/modules\/marketing\/|\/modules\/provisioning\/|\/modules\/superadmin\/services\/superadmin-marketing\.service\.ts$)/;
    const offenders: string[] = [];
    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (
          entry.name.endsWith('.ts') &&
          !entry.name.endsWith('.spec.ts') &&
          !entry.name.endsWith('.d.ts')
        ) {
          if (allowPath.test(full)) continue;
          if (forbidden.test(fs.readFileSync(full, 'utf8'))) {
            offenders.push(path.relative(BACKEND_ROOT, full));
          }
        }
      }
    }
    walk(SRC_ROOT);

    // v3.0.1 round-4 — known violation pinned for v3.1 refactor.
    // catalog.service.ts:requestQuote writes Lead directly when an
    // admin requests a hardware quote on a QUOTE_ONLY device. The
    // file's own comment block ("When marketing splits to its own DB
    // this should become an outbox event instead of a direct write")
    // acknowledges the seam; the v3.1 follow-up is to route the
    // request through an outbox event consumed by a marketing-side
    // LeadIngestService. Pinning the exact-equal expectation locks
    // current state — if a NEW core module starts writing marketing
    // tables, this assertion fails. If the v3.1 refactor lands, this
    // pin must be tightened back to `[]`.
    const KNOWN_VIOLATIONS = ['src/modules/catalog/catalog.service.ts'];
    expect(offenders.sort()).toEqual(KNOWN_VIOLATIONS.sort());
  });
});

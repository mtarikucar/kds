/**
 * Playwright global setup — runs once before the entire test suite.
 *
 * Restores Sultanahmet to its fresh BUSINESS-tier baseline. Without
 * this, plan-switching specs that run mid-suite leave Sultanahmet on
 * a downgraded plan (PRO) with the limits already filled by previous
 * runs; subsequent table/category-creating specs then 403 with
 * "limit reached" and 25+ tests cascade-fail on a stale state that has
 * nothing to do with the code under test.
 *
 * The two seeders are idempotent — re-running them is safe — and
 * collectively take ~20s, an acceptable tax for a 13-minute suite.
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';

export default async function globalSetup() {
  const backendDir = path.resolve(__dirname, '../../backend');
  // Pipe through inherit so failures surface in the Playwright console
  // immediately rather than landing in a captured-but-silent buffer.
  // Failing here aborts the whole run — that's intentional: a botched
  // seed means every downstream test fails for the wrong reason.
  console.log('[global-setup] seeding platform users + demo tenant…');
  execSync('npx ts-node prisma/seed-platform-users.ts', {
    cwd: backendDir,
    stdio: 'inherit',
  });
  execSync('npx ts-node prisma/seed-demo.ts', {
    cwd: backendDir,
    stdio: 'inherit',
  });
  console.log('[global-setup] ✅ baseline state restored');
}

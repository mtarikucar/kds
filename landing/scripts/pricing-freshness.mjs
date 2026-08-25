#!/usr/bin/env node
/**
 * Build gate: refuse to publish a stale price index.
 *
 * The page's whole claim is that its numbers are sourced AND current. A
 * comparison table that keeps its authority while losing its accuracy is worse
 * than not publishing one — readers and answer engines both treat a dated table
 * as more trustworthy than an undated one, so the date has to mean something.
 *
 * Every row carries `capturedAt`, the day that vendor's page was actually read.
 * When any row passes MAX_AGE_DAYS the build stops until someone re-reads the
 * source. There is no "warn and continue" mode on purpose: a warning in a CI
 * log is a warning nobody sees.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'src/content/pricing-index.ts');
const source = readFileSync(file, 'utf8');

const maxAge = Number(source.match(/MAX_AGE_DAYS\s*=\s*(\d+)/)?.[1]);
if (!Number.isFinite(maxAge)) {
  console.error('pricing-freshness: could not read MAX_AGE_DAYS from pricing-index.ts');
  process.exit(1);
}

// Pair each capturedAt with the nearest preceding sourceUrl so the failure
// message can name the page that needs re-reading, not just a date.
const entries = [];
const re = /sourceUrl:\s*'([^']+)'[\s\S]{0,200}?capturedAt:\s*'(\d{4}-\d{2}-\d{2})'/g;
let m;
while ((m = re.exec(source))) entries.push({ url: m[1], captured: m[2] });

if (!entries.length) {
  console.error('pricing-freshness: no capturedAt entries found — did the file shape change?');
  process.exit(1);
}

const today = new Date();
const stale = [];
for (const e of entries) {
  const ageDays = Math.floor((today - new Date(e.captured)) / 86_400_000);
  if (ageDays > maxAge) stale.push({ ...e, ageDays });
}

if (stale.length) {
  const byUrl = new Map();
  for (const s of stale) {
    if (!byUrl.has(s.url) || byUrl.get(s.url) < s.ageDays) byUrl.set(s.url, s.ageDays);
  }
  console.error(
    `\npricing-freshness FAILED — ${stale.length} row(s) older than ${maxAge} days.\n`,
  );
  console.error('Re-read these pages and update priceText, vat and capturedAt:\n');
  for (const [url, age] of byUrl) console.error(`  ${age} days old — ${url}`);
  console.error(
    '\nDo not bump capturedAt without re-reading the page. The date is the claim.\n',
  );
  process.exit(1);
}

const oldest = Math.max(
  ...entries.map((e) => Math.floor((today - new Date(e.captured)) / 86_400_000)),
);
console.log(
  `pricing-freshness OK (${entries.length} rows, oldest ${oldest} day(s), limit ${maxAge})`,
);

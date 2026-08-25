#!/usr/bin/env node
/**
 * Push freshly published URLs at IndexNow.
 *
 * IndexNow is the only channel in this program that tells an engine about a URL
 * instead of waiting to be crawled. Bing consumes it, and Bing is what feeds
 * Copilot — so for that surface this is the difference between "indexed in
 * days" and "indexed when a crawler happens by". Google states it does not use
 * IndexNow; nothing here assumes otherwise.
 *
 * Reads the deployed sitemap so it submits exactly what is published, rather
 * than a hand-maintained list that drifts.
 *
 *   node scripts/indexnow-submit.mjs https://landing.hummytummy.com
 *   node scripts/indexnow-submit.mjs http://127.0.0.1:3386 --dry-run
 *
 * The key must be reachable at <host>/<key>.txt containing the key and nothing
 * else — that file is how the engine verifies we control the host, so the .txt
 * in public/ and INDEXNOW_KEY have to stay in step.
 *
 * Behind a TLS-inspecting proxy, run with `node --use-system-ca`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
// --dry-run does everything except the POST, so the key resolution and the
// sitemap read can be exercised before the key file is actually published on
// the host. Submitting from a host that cannot serve <key>.txt just fails
// validation and burns the key's reputation.
const dryRun = args.includes('--dry-run');
const base = (args.find((a) => !a.startsWith('--')) || process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

if (!base) {
  console.error('usage: node scripts/indexnow-submit.mjs <https://host>');
  process.exit(1);
}

/** The key lives in public/ as <key>.txt; read it back rather than duplicating it. */
function resolveKey() {
  if (process.env.INDEXNOW_KEY) return process.env.INDEXNOW_KEY.trim();
  const candidates = readdirSync(join(root, 'public')).filter((f) =>
    /^[0-9a-f]{8,128}\.txt$/.test(f),
  );
  if (candidates.length !== 1) {
    console.error(
      `Expected exactly one IndexNow key file in public/, found ${candidates.length}. ` +
        'Set INDEXNOW_KEY to disambiguate.',
    );
    process.exit(1);
  }
  return readFileSync(join(root, 'public', candidates[0]), 'utf8').trim();
}

const key = resolveKey();
const host = new URL(base).host;

const sitemap = await fetch(`${base}/sitemap.xml`).then((r) => {
  if (!r.ok) throw new Error(`sitemap.xml returned HTTP ${r.status}`);
  return r.text();
});

// A bot-check page answers 200 with HTML and would otherwise surface as
// "no <loc> entries", which reads like a broken sitemap rather than a
// challenged client.
if (/just a moment|attention required|__cf_chl|challenge-platform/i.test(sitemap.slice(0, 4000))) {
  console.error(
    `${base}/sitemap.xml returned a bot-check page, not the sitemap. ` +
      'Run this from an allowlisted network; the sitemap itself is fine.',
  );
  process.exit(1);
}
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

if (!urlList.length) {
  console.error('No <loc> entries in the sitemap — refusing to submit an empty list.');
  process.exit(1);
}

// The endpoint caps a submission at 10,000 URLs; we are far under, but chunk
// anyway so this keeps working if the store catalogue grows.
const CHUNK = 10_000;
let submitted = 0;
for (let i = 0; i < urlList.length; i += CHUNK) {
  const chunk = urlList.slice(i, i + CHUNK);
  if (dryRun) {
    console.log(
      `[dry-run] would POST ${chunk.length} URL(s) for ${host} with keyLocation ${base}/${key}.txt`,
    );
    console.log(`[dry-run] first: ${chunk[0]}`);
    console.log(`[dry-run] last:  ${chunk[chunk.length - 1]}`);
    submitted += chunk.length;
    continue;
  }

  const res = await fetch('https://api.indexnow.org/IndexNow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host,
      key,
      keyLocation: `${base}/${key}.txt`,
      urlList: chunk,
    }),
  });
  // 200 = accepted, 202 = accepted but key still being validated. Both fine.
  if (res.status !== 200 && res.status !== 202) {
    console.error(`IndexNow returned HTTP ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  submitted += chunk.length;
}

console.log(
  `indexnow-submit OK — ${submitted} URL(s) ${dryRun ? 'would be submitted' : 'submitted'} for ${host}`,
);

#!/usr/bin/env node
/**
 * Post-deploy gate: every URL the sitemap submits must canonicalise to itself.
 *
 * This existed as a live defect. `alternates` was declared once on
 * [locale]/layout.tsx and Next merges metadata by shallow override, so every
 * page that did not restate it inherited `canonical: /${locale}`. The sitemap
 * kept submitting 110 URLs while 95 of them told crawlers to index the locale
 * homepage instead — the whole hardware store included. Nothing failed; the
 * pages rendered correctly and simply asked not to be indexed.
 *
 * A unit test cannot catch this: the bug lives in what Next emits after
 * merging layout and page metadata. So this runs against a real origin.
 *
 *   node scripts/canonical-check.mjs https://landing.hummytummy.com
 *   node scripts/canonical-check.mjs            # defaults to localhost:3000
 *
 * Behind a TLS-inspecting corporate proxy Node will not trust the intercepting
 * CA even when curl does; run it as `node --use-system-ca scripts/…` there.
 */
const base = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');
const LIMIT = Number(process.env.CANONICAL_CHECK_LIMIT || 0); // 0 = all

const fail = [];
const warn = [];

async function text(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const sitemapXml = await text(`${base}/sitemap.xml`);
let urls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());

// The sitemap carries absolute URLs built from NEXT_PUBLIC_BASE_URL, which on a
// local server still points at the production host. Fetching those would test
// the deployed site instead of the build in front of you, so the origin is
// rewritten onto whatever base was asked for. The canonical comparison below
// then runs against that same base, which is the point: it tells you the build
// is correct BEFORE it ships, not after.
urls = urls.map((u) => {
  try {
    const parsed = new URL(u);
    return `${base}${parsed.pathname}`;
  } catch {
    return u;
  }
});
if (!urls.length) {
  console.error(`No <loc> entries at ${base}/sitemap.xml`);
  process.exit(1);
}
if (LIMIT) urls = urls.slice(0, LIMIT);

console.log(`canonical-check: ${urls.length} URL(s) from ${base}/sitemap.xml\n`);

// Modest concurrency: enough to finish quickly, low enough not to look like a
// burst to whatever sits in front of the origin.
const queue = [...urls];
async function worker() {
  while (queue.length) {
    const url = queue.shift();
    try {
      const html = await text(url);
      const canonical = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1];
      // Compare paths, not full URLs: the host in a canonical tag comes from
      // the build-time NEXT_PUBLIC_BASE_URL and will legitimately differ from
      // the origin being probed when checking a local build.
      const path = (u) => {
        try {
          return new URL(u).pathname.replace(/\/+$/, '');
        } catch {
          return u.replace(/\/+$/, '');
        }
      };
      if (!canonical) {
        fail.push(`${url}\n      no <link rel="canonical"> at all`);
      } else if (path(canonical) !== path(url)) {
        fail.push(`${url}\n      canonicalises to ${canonical}`);
      }
      if (!/hreflang="x-default"/i.test(html)) {
        warn.push(`${url} — no x-default hreflang`);
      }
    } catch (err) {
      fail.push(`${url}\n      fetch failed: ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));

for (const w of warn) console.warn(`  warn: ${w}`);
if (fail.length) {
  console.error(`\ncanonical-check FAILED — ${fail.length} of ${urls.length} URL(s):\n`);
  for (const f of fail) console.error(`  ${f}\n`);
  process.exit(1);
}
console.log(`\ncanonical-check OK — all ${urls.length} URLs canonicalise to themselves`);

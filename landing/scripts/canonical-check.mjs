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
 *   node scripts/canonical-check.mjs https://landing.hummytummy.com \\
 *        --expect-origin=https://landing.hummytummy.com
 *
 * Behind a TLS-inspecting corporate proxy Node will not trust the intercepting
 * CA even when curl does; run it as `node --use-system-ca scripts/…` there.
 */
const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) || 'http://localhost:3000').replace(/\/+$/, '');

/**
 * --expect-origin=https://landing.hummytummy.com
 *
 * Without it this compares paths only, because the canonical's host comes from
 * the build-time NEXT_PUBLIC_BASE_URL and legitimately differs from the origin
 * being probed when checking a local build. But the incident this repo actually
 * had was a wrong HOST — canonicals pointing at the apex, where every URL is
 * answered by the SPA shell — and a path-only comparison reports that as fine.
 * Pass this against a deployed site to check the half that bit us.
 */
const expectOrigin = args
  .find((a) => a.startsWith('--expect-origin='))
  ?.slice('--expect-origin='.length)
  .replace(/\/+$/, '');
const LIMIT = Number(process.env.CANONICAL_CHECK_LIMIT || 0); // 0 = all

const fail = [];
const warn = [];
const blocked = [];


/**
 * A bot-check page answers 200 with HTML, so nothing above notices it.
 *
 * This is not hypothetical here: a sibling release workflow had Cloudflare
 * serve "Just a moment..." to a GitHub runner probing the public API, and the
 * check reported a broken release that was in fact fine. The same wall stands
 * in front of these hosts. Detect it and say so, rather than reporting 64
 * pages with no canonical or a sitemap with no URLs.
 */
function wafChallenge(body) {
  return (
    /just a moment|attention required|__cf_chl|cf-browser-verification|challenge-platform/i.test(
      body.slice(0, 4000),
    ) && !/<urlset|<link[^>]+rel="canonical"/i.test(body.slice(0, 4000))
  );
}

/**
 * A corporate proxy or content filter between this client and the site.
 *
 * Found the hard way. Run against production, this check reported 2 of 139 URLs
 * as failures with HTTP 403. The first guess was Cloudflare throttling, and it
 * was wrong: the same two URLs failed on every retry and under every user
 * agent, while their neighbours passed. The body turned out to be a corporate
 * filter's "Access Denied" page — the network this ran from classifies those
 * two pages as "Shopping" and blocks them. Nothing to do with the site.
 *
 * Retrying cannot help against a policy block, and calling it throttling sends
 * whoever reads the output to the wrong console. So it is named for what it is.
 */
function proxyBlock(body) {
  return /access denied|erişime kapatılmış|your system policy|blocked by .{0,30}policy/i.test(
    body.slice(0, 3000),
  );
}

/** Transient statuses worth one more try. 403 is NOT here: it is a decision. */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

class BlockedError extends Error {}

async function text(url, attempt = 1) {
  const res = await fetch(url, { redirect: 'follow' });
  if (res.ok) return res.text();

  if (res.status === 403) {
    const body = await res.text().catch(() => '');
    if (proxyBlock(body)) {
      throw new BlockedError('blocked by an intermediary on this network, not by the site');
    }
  }

  if (RETRYABLE.has(res.status) && attempt <= 2) {
    await new Promise((r) => setTimeout(r, attempt * 2500));
    return text(url, attempt + 1);
  }
  throw new Error(`HTTP ${res.status}`);
}

const sitemapXml = await text(`${base}/sitemap.xml`);
if (wafChallenge(sitemapXml)) {
  console.error(
    `\n${base}/sitemap.xml returned a bot-check page, not the sitemap.\n` +
      'Whatever sits in front of this host (Cloudflare, a WAF) is challenging this\n' +
      'client. Nothing is wrong with the site — run the check from a browser-like\n' +
      'client or an allowlisted network. Do NOT read this as a missing sitemap.\n',
  );
  process.exit(1);
}
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

// Low concurrency on purpose. Six parallel fetches was enough for Cloudflare to
// 403 two URLs out of 139 on a real run; three plus the retry above completes
// the sweep without tripping it.
const queue = [...urls];
async function worker() {
  while (queue.length) {
    const url = queue.shift();
    try {
      const html = await text(url);
      if (wafChallenge(html)) {
        fail.push(`${url}\n      bot-check page returned instead of the page (WAF, not a site defect)`);
        continue;
      }
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
      const origin = (u) => {
        try {
          return new URL(u).origin;
        } catch {
          return null;
        }
      };
      if (!canonical) {
        fail.push(`${url}\n      no <link rel="canonical"> at all`);
      } else if (expectOrigin && origin(canonical) !== expectOrigin) {
        fail.push(
          `${url}\n      canonical host is ${origin(canonical)}, expected ${expectOrigin}`,
        );
      } else if (path(canonical) !== path(url)) {
        fail.push(`${url}\n      canonicalises to ${canonical}`);
      }
      if (!/hreflang="x-default"/i.test(html)) {
        warn.push(`${url} — no x-default hreflang`);
      }
    } catch (err) {
      if (err instanceof BlockedError) blocked.push(url);
      else fail.push(`${url}\n      fetch failed: ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 3 }, worker));

for (const w of warn) console.warn(`  warn: ${w}`);

if (blocked.length) {
  console.error(
    `\n${blocked.length} URL(s) could not be checked — an intermediary on this ` +
      'network returned an Access Denied page for them. The site is not implicated;\n' +
      'these are simply unverified. Re-run from a network that can reach them.\n',
  );
  for (const b of blocked) console.error(`  unchecked: ${b}`);
}
if (fail.length) {
  console.error(`\ncanonical-check FAILED — ${fail.length} of ${urls.length} URL(s):\n`);
  for (const f of fail) console.error(`  ${f}\n`);
  process.exit(1);
}
// Unverified is not verified: exiting 0 here would let a real problem hide
// behind a network block on the same URL.
if (blocked.length) {
  console.error(
    `\ncanonical-check INCOMPLETE — ${urls.length - blocked.length} of ${urls.length} ` +
      'URLs verified, the rest unreachable from here.\n',
  );
  process.exit(2);
}

console.log(`\ncanonical-check OK — all ${urls.length} URLs canonicalise to themselves`);

#!/usr/bin/env node
/**
 * Walks the Nextra page tree and emits the route list the sitemap serves.
 *
 * This runs at build time rather than at request time because the standalone
 * Next image does not carry pages/*.mdx — only compiled output — so a runtime
 * directory walk would find nothing and quietly emit an empty sitemap.
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pagesDir = join(root, 'pages');
const LOCALES = ['tr', 'en'];

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (entry.endsWith('.mdx')) acc.push(full);
  }
  return acc;
}

// Slugs are shared across locales by design (the language switcher only swaps
// the leading segment), so the route set is the union across locales — a page
// present in one locale but not the other would otherwise emit an hreflang
// pointing at a 404.
const slugs = new Set();
for (const locale of LOCALES) {
  for (const file of walk(join(pagesDir, locale))) {
    const rel = relative(join(pagesDir, locale), file).replace(/\.mdx$/, '');
    slugs.add(rel === 'index' ? '' : `/${rel.replace(/\/index$/, '')}`);
  }
}

const routes = [...slugs].sort();
writeFileSync(
  join(root, 'sitemap-routes.generated.json'),
  JSON.stringify({ locales: LOCALES, routes }, null, 2) + '\n',
);
console.log(`gen-sitemap-routes: ${routes.length} route(s) x ${LOCALES.length} locales`);

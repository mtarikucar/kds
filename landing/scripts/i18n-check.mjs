#!/usr/bin/env node
/**
 * v2.8.99 — landing i18n consistency check.
 *
 * Runs at build time (or `npm run i18n-check`) and verifies:
 *   1. Every locale file parses as valid JSON.
 *   2. The key set of each non-default locale is a SUPERSET of `en` keys
 *      (no missing translations). New keys can be added in non-default
 *      locales (e.g. region-specific footnotes) without failing.
 *   3. Locales declared as RTL in i18n/config.ts (currently `ar`) have
 *      a non-empty `contact.form.title` so the contact form actually
 *      renders for that audience — a smoke check that the RTL audit
 *      coverage doesn't silently regress.
 *
 * Pre-fix nobody verified that a freshly-added key in en.json was
 * propagated to ar/ru/uz; the t() call would surface the raw key
 * to the visitor.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const messagesDir = join(__dirname, '..', 'src', 'i18n', 'messages');
const RTL_LOCALES = new Set(['ar']);

function flatten(obj, prefix = '', acc = new Set()) {
  for (const [key, value] of Object.entries(obj ?? {})) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, fullKey, acc);
    } else {
      acc.add(fullKey);
    }
  }
  return acc;
}

function load(locale) {
  const path = join(messagesDir, `${locale}.json`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function getByPath(obj, path) {
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

const files = readdirSync(messagesDir).filter((f) => f.endsWith('.json'));
const locales = files.map((f) => f.replace(/\.json$/, ''));
if (!locales.includes('en')) {
  console.error('i18n-check: en.json missing');
  process.exit(1);
}

const enKeys = flatten(load('en'));
const errors = [];

for (const locale of locales) {
  if (locale === 'en') continue;
  let messages;
  try {
    messages = load(locale);
  } catch (err) {
    errors.push(`${locale}.json failed to parse: ${err.message}`);
    continue;
  }
  const localeKeys = flatten(messages);
  const missing = [...enKeys].filter((k) => !localeKeys.has(k));
  if (missing.length > 0) {
    errors.push(
      `${locale}.json missing ${missing.length} keys: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`,
    );
  }

  if (RTL_LOCALES.has(locale)) {
    const formTitle = getByPath(messages, 'contact.form.title');
    if (typeof formTitle !== 'string' || formTitle.length === 0) {
      errors.push(`${locale}.json (RTL): contact.form.title is empty or missing — RTL audience would see the raw key`);
    }
  }
}

if (errors.length > 0) {
  console.error('i18n-check FAILED:');
  for (const e of errors) console.error('  -', e);
  process.exit(1);
}

console.log(`i18n-check OK (${locales.length} locales, ${enKeys.size} keys)`);

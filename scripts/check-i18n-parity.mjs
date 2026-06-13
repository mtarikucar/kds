#!/usr/bin/env node
/**
 * i18n parity guard. Every non-fallback locale must define every key the
 * fallback locale (en) defines — otherwise that string silently renders in
 * English for a ru/ar/uz/tr user (the audit found ~120 keys/locale drifting
 * this way). This script parses every locale namespace from source and fails
 * CI on any MISSING key. Orphan keys (present in a locale but not en) are
 * reported as warnings only — they're dead weight, not a user-facing bug.
 *
 * Run from the repo root:  node scripts/check-i18n-parity.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = join(repoRoot, "frontend/src/i18n/locales");
const REFERENCE = "en";

/** Flatten a nested translation object to dot-notation leaf keys. */
function flatten(obj, prefix = "", out = {}) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = true;
  }
  return out;
}

function readJson(locale, ns) {
  try {
    return JSON.parse(readFileSync(join(LOCALES_DIR, locale, ns), "utf8"));
  } catch {
    return null;
  }
}

const locales = readdirSync(LOCALES_DIR).filter(
  (l) => !l.startsWith(".") && l !== REFERENCE,
);
const namespaces = readdirSync(join(LOCALES_DIR, REFERENCE)).filter((f) =>
  f.endsWith(".json"),
);

let missingTotal = 0;
let orphanTotal = 0;
const missingByLocale = {};

for (const ns of namespaces) {
  const ref = readJson(REFERENCE, ns);
  if (!ref) {
    console.error(`✗ reference locale missing namespace ${ns}`);
    missingTotal += 1;
    continue;
  }
  const refKeys = Object.keys(flatten(ref));

  for (const locale of locales) {
    const data = readJson(locale, ns);
    const localeKeys = new Set(data ? Object.keys(flatten(data)) : []);
    const missing = refKeys.filter((k) => !localeKeys.has(k));
    const orphans = data
      ? [...localeKeys].filter((k) => !refKeys.includes(k))
      : [];
    if (missing.length) {
      missingTotal += missing.length;
      (missingByLocale[locale] ??= []).push(
        `${ns} (${missing.length}): ${missing.slice(0, 8).join(", ")}${
          missing.length > 8 ? ", …" : ""
        }`,
      );
    }
    orphanTotal += orphans.length;
  }
}

if (missingTotal === 0) {
  console.log(
    `✓ i18n parity: every locale (${locales.join(", ")}) defines all ${REFERENCE} keys` +
      (orphanTotal ? ` (${orphanTotal} orphan key(s) — dead weight, non-blocking)` : ""),
  );
  process.exit(0);
}

console.error(
  `✗ i18n parity drift — ${missingTotal} key(s) missing vs the '${REFERENCE}' fallback (would silently render in English):`,
);
for (const locale of Object.keys(missingByLocale)) {
  console.error(`  ${locale}:`);
  for (const line of missingByLocale[locale]) console.error(`    ${line}`);
}
console.error(
  `\nAdd the missing keys to the locale namespaces above. Run node scripts/check-i18n-parity.mjs to verify.`,
);
process.exit(1);

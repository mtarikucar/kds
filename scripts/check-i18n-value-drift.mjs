#!/usr/bin/env node
/**
 * i18n VALUE-DRIFT guard. The companion parity guard
 * (scripts/check-i18n-parity.mjs) only verifies KEY presence — it is blind to
 * keys whose VALUE is still raw English in a non-en locale. A ru/ar/uz user
 * then sees an English string even though the key "exists". This script
 * flags every leaf key where a non-en locale value is byte-identical to the
 * en value (a strong signal the translation was never filled in).
 *
 * Tuning to keep the signal honest:
 *   - MIN_LETTERS    : ignore values with too few letters (codes, "#", "/").
 *   - MIN_WORDS      : ignore single-token values unless allow-listed below —
 *                      one shared word is usually a brand/term, a sentence is not.
 *   - ALLOW (Set)    : exact values that legitimately match across locales
 *                      (brand names, "OK", "PIN"/"ID", units, url/email
 *                      placeholders). Compared case-insensitively, trimmed.
 *   - ALLOW_KEY (RegExp[]) : key suffixes that are allowed to share the en value
 *                      (e.g. proper-noun day names you choose not to localise).
 *
 * Behaviour: WARN-by-default. Prints a per-locale worklist and a total count,
 * then exits 0 so it never hard-fails CI on the existing backlog. Pass
 * `--gate-new <baseline.json>` to FAIL only on drift NOT already recorded in a
 * committed baseline (newly-introduced regressions), and `--write-baseline
 * <path>` to (re)generate that baseline. With no flags it is purely advisory.
 *
 * Run from the repo root:  node scripts/check-i18n-value-drift.mjs
 *
 * CI WIRING (one line, lives next to the parity check in the `contract-drift`
 * job of .github/workflows/quality-gates.yml — left for the workflow owner to
 * add so this change stays inside the i18n area):
 *
 *     - name: Check i18n value drift (no NEW English placeholders)
 *       run: node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json
 *
 * `--gate-new` blocks only drift NOT in scripts/i18n-value-drift-baseline.json,
 * so the existing backlog never fails CI but a freshly-untranslated value does.
 * Regenerate the baseline after an intentional fill with --write-baseline.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = join(repoRoot, "frontend/src/i18n/locales");
const REFERENCE = "en";

// --- tuning -----------------------------------------------------------------
const MIN_LETTERS = 3; // a leaf must have >=3 letters to count as "wordy"
const MIN_WORDS = 2; // single-token values are skipped unless allow-listed

/** Exact values that may legitimately be identical across locales. */
const ALLOW = new Set(
  [
    "OK",
    "PIN",
    "ID",
    "URL",
    "Email",
    "E-mail",
    "SMS",
    "QR",
    "POS",
    "KDS",
    "VAT",
    "PDF",
    "CSV",
    "API",
    "Wi-Fi",
    "WiFi",
    "USD",
    "EUR",
    "TRY",
    "RUB",
    "UZS",
    "AED",
    "kg",
    "g",
    "ml",
    "l",
    "cm",
    "mm",
    "%",
    "{{count}}",
    "{{date}}",
    "—",
    "-",
    "/",
    "#",
    // brand / product / protocol tokens that read the same in every locale
    "Client ID",
    "Client Secret",
    "API URL",
    "API Key",
    "USB HID",
    "Twitter / X",
    "WhatsApp Business",
    "Aa Bb Cc",
    "John Doe",
  ].map((s) => s.toLowerCase()),
);

/**
 * Value-shape allow-list: a leaf whose value matches any of these is treated
 * as a shared token regardless of word count (email/url/phone placeholders,
 * pure brand-name strings, version/format samples).
 */
const ALLOW_VALUE = [
  /^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i, // email placeholder e.g. john@example.com
  /^https?:\/\//i, // url placeholder
  /^\+?[\d ()-]{6,}$/, // phone-number placeholder
];

/** Key suffixes (dot-notation) allowed to share the en value verbatim. */
const ALLOW_KEY = [
  // add e.g. /\.brand$/ here for keys that are intentionally untranslated.
];

// --- helpers ----------------------------------------------------------------
/** Flatten to dot-notation leaf -> value (only string leaves are returned). */
function flatten(obj, prefix = "", out = {}) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
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

function letterCount(s) {
  // Unicode letters across scripts (Latin/Cyrillic/Arabic), not just ASCII.
  const m = String(s).match(/\p{L}/gu);
  return m ? m.length : 0;
}

function wordCount(s) {
  const m = String(s).trim().match(/\p{L}[\p{L}\p{M}'’-]*/gu);
  return m ? m.length : 0;
}

/** Does this leaf key/value qualify as a drift candidate at all? */
function isCandidate(key, value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (ALLOW.has(trimmed.toLowerCase())) return false;
  if (ALLOW_VALUE.some((re) => re.test(trimmed))) return false;
  if (ALLOW_KEY.some((re) => re.test(key))) return false;
  if (letterCount(trimmed) < MIN_LETTERS) return false;
  if (wordCount(trimmed) < MIN_WORDS) return false;
  return true;
}

// --- scan -------------------------------------------------------------------
const locales = readdirSync(LOCALES_DIR).filter(
  (l) => !l.startsWith(".") && l !== REFERENCE,
);
const namespaces = readdirSync(join(LOCALES_DIR, REFERENCE)).filter((f) =>
  f.endsWith(".json"),
);

/** drift[locale] = [ "ns#dotkey", ... ] */
const drift = {};
let driftTotal = 0;

for (const ns of namespaces) {
  const ref = readJson(REFERENCE, ns);
  if (!ref) continue;
  const refFlat = flatten(ref);

  for (const locale of locales) {
    const data = readJson(locale, ns);
    if (!data) continue;
    const flat = flatten(data);
    for (const key of Object.keys(refFlat)) {
      const enVal = refFlat[key];
      if (!isCandidate(key, enVal)) continue;
      if (Object.prototype.hasOwnProperty.call(flat, key) && flat[key] === enVal) {
        (drift[locale] ??= []).push(`${ns}#${key}`);
        driftTotal += 1;
      }
    }
  }
}

// --- modes ------------------------------------------------------------------
const args = process.argv.slice(2);
const writeIdx = args.indexOf("--write-baseline");
const gateIdx = args.indexOf("--gate-new");

if (writeIdx !== -1) {
  const out = args[writeIdx + 1];
  if (!out) {
    console.error("--write-baseline requires a path");
    process.exit(2);
  }
  const sorted = {};
  for (const l of Object.keys(drift).sort()) sorted[l] = [...drift[l]].sort();
  writeFileSync(join(repoRoot, out), JSON.stringify(sorted, null, 2) + "\n");
  console.log(
    `✓ wrote value-drift baseline (${driftTotal} entr${driftTotal === 1 ? "y" : "ies"}) to ${out}`,
  );
  process.exit(0);
}

// Always print the advisory worklist.
if (driftTotal === 0) {
  console.log(
    `✓ i18n value-drift: no non-en leaf still equals its '${REFERENCE}' value` +
      ` (threshold: >=${MIN_LETTERS} letters, >=${MIN_WORDS} words, allow-list applied)`,
  );
} else {
  console.warn(
    `⚠ i18n value-drift: ${driftTotal} leaf value(s) across ${
      Object.keys(drift).length
    } locale(s) still render raw '${REFERENCE}' English (key parity OK, but untranslated):`,
  );
  for (const locale of Object.keys(drift).sort()) {
    const list = drift[locale];
    console.warn(`  ${locale} (${list.length}):`);
    for (const entry of list.slice(0, 12)) console.warn(`    ${entry}`);
    if (list.length > 12) console.warn(`    … and ${list.length - 12} more`);
  }
  console.warn(
    `\nThis is advisory (WARN) — it does not fail CI on the existing backlog.\n` +
      `Fill these values (VALUE-only, preserving every {{placeholder}}/ICU token).\n` +
      `To block only NEW drift, commit a baseline:\n` +
      `  node scripts/check-i18n-value-drift.mjs --write-baseline scripts/i18n-value-drift-baseline.json\n` +
      `and run with: node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json`,
  );
}

// Optional regression gate: fail only on entries absent from the baseline.
if (gateIdx !== -1) {
  const baselinePath = args[gateIdx + 1];
  if (!baselinePath) {
    console.error("--gate-new requires a baseline path");
    process.exit(2);
  }
  let baseline = {};
  try {
    baseline = JSON.parse(readFileSync(join(repoRoot, baselinePath), "utf8"));
  } catch {
    console.error(
      `✗ baseline ${baselinePath} not found — generate it with --write-baseline first`,
    );
    process.exit(2);
  }
  const newDrift = {};
  let newTotal = 0;
  for (const locale of Object.keys(drift)) {
    const known = new Set(baseline[locale] || []);
    const fresh = drift[locale].filter((e) => !known.has(e));
    if (fresh.length) {
      newDrift[locale] = fresh;
      newTotal += fresh.length;
    }
  }
  if (newTotal === 0) {
    console.log(
      `✓ i18n value-drift gate: no NEWLY-introduced English placeholders vs baseline`,
    );
    process.exit(0);
  }
  console.error(
    `✗ i18n value-drift gate: ${newTotal} NEW English placeholder(s) introduced (not in baseline):`,
  );
  for (const locale of Object.keys(newDrift).sort()) {
    console.error(`  ${locale}:`);
    for (const entry of newDrift[locale]) console.error(`    ${entry}`);
  }
  console.error(
    `\nTranslate these values, or (if intentional) extend the ALLOW list / regenerate the baseline.`,
  );
  process.exit(1);
}

process.exit(0);

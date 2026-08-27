#!/usr/bin/env node
/**
 * i18n parity guard. Two passes, both blocking.
 *
 * PASS 1 — locale parity. Every non-fallback locale must define every key the
 * fallback locale (en) defines — otherwise that string silently renders in
 * English for a ru/ar/uz/tr user (the audit found ~120 keys/locale drifting
 * this way). Orphan keys (present in a locale but not en) are reported as
 * warnings only — they're dead weight, not a user-facing bug.
 *
 * PASS 2 — undeclared defaultValue. Pass 1 compares the locale files to EACH
 * OTHER, so a key that is missing from ALL of them is invisible to it: the
 * t('some.key', 'Some English') defaultValue quietly renders and every guest
 * on every tenant reads English. The QR menu shipped eleven of these — the
 * drawer, the cart hints and the empty states were English on a Turkish
 * restaurant's phone. So: every t() call site that carries a literal
 * defaultValue must name a key that some locale namespace actually declares.
 *
 * Run from the repo root:  node scripts/check-i18n-parity.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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

/**
 * The CLDR plural categories i18next appends to a key. Only these six — a
 * strict list, unlike PASS 2's deliberately loose context matcher — because
 * this one decides whether a key is DEAD, and `foo_bar` must stay reportable.
 */
const CLDR_PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

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
  /*
   * A locale legitimately carries plural forms `en` has no word for: Arabic
   * needs zero/two/few/many, Russian needs few/many. `cart.itemCount_many` is
   * therefore NOT dead weight — it is the ar/ru half of the `cart.itemCount`
   * family en declares as _one/_other. Match on the stripped base so those
   * forms stop inflating the orphan count.
   */
  const refPluralBases = new Set(
    refKeys
      .filter((k) => CLDR_PLURAL_SUFFIX.test(k))
      .map((k) => k.replace(CLDR_PLURAL_SUFFIX, "")),
  );

  for (const locale of locales) {
    const data = readJson(locale, ns);
    const localeKeys = new Set(data ? Object.keys(flatten(data)) : []);
    const missing = refKeys.filter((k) => !localeKeys.has(k));
    const orphans = data
      ? [...localeKeys].filter(
          (k) =>
            !refKeys.includes(k) &&
            !(
              CLDR_PLURAL_SUFFIX.test(k) &&
              refPluralBases.has(k.replace(CLDR_PLURAL_SUFFIX, ""))
            ),
        )
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

let failed = false;

if (missingTotal === 0) {
  console.log(
    `✓ i18n parity: every locale (${locales.join(", ")}) defines all ${REFERENCE} keys` +
      (orphanTotal ? ` (${orphanTotal} orphan key(s) — dead weight, non-blocking)` : ""),
  );
} else {
  failed = true;
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
}

/* ── PASS 2: t() defaultValues must name a declared key ──────────────────── */

const SRC_DIR = join(repoRoot, "frontend/src");
const SOURCE_EXT = /\.(t|j)sx?$/;
const SKIP_FILE = /\.(test|spec)\.(t|j)sx?$/;

/**
 * Every key declared per NAMESPACE, unioned over the locales.
 *
 * Per-namespace, not one global pile: i18next resolves `t('common.loading')`
 * inside the namespace the call site is bound to and nowhere else. Checking a
 * global union passes a key that some UNRELATED namespace happens to declare —
 * `common.loading` exists only in personnel.json, so the QR-menu loyalty panel
 * (bound to `common`) rendered its English default while the guard said fine.
 */
const declaredByNs = new Map();
for (const locale of [REFERENCE, ...locales]) {
  let files;
  try {
    files = readdirSync(join(LOCALES_DIR, locale));
  } catch {
    continue;
  }
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    const data = readJson(locale, file);
    if (!data) continue;
    const ns = file.replace(/\.json$/, "");
    let set = declaredByNs.get(ns);
    if (!set) declaredByNs.set(ns, (set = new Set()));
    for (const k of Object.keys(flatten(data))) set.add(k);
  }
}

/**
 * A key is declared if it appears verbatim, or if the locale files carry its
 * plural family instead (`cart.itemCount` is declared by `cart.itemCount_one`
 * + `cart.itemCount_other`), or if it is a context variant of a declared key.
 */
const pluralOrContextSuffix = /_(zero|one|two|few|many|other|[A-Za-z0-9]+)$/;
const declaredBasesByNs = new Map(
  [...declaredByNs].map(([ns, keys]) => [
    ns,
    new Set([...keys].map((k) => k.replace(pluralOrContextSuffix, ""))),
  ]),
);
const isDeclaredIn = (ns, key) => {
  const keys = declaredByNs.get(ns);
  if (!keys) return false; // `useTranslation('legal')` — no such namespace file
  return (
    keys.has(key) ||
    declaredBasesByNs.get(ns).has(key) ||
    keys.has(key.replace(pluralOrContextSuffix, ""))
  );
};

/**
 * The namespaces a `t` in this file can resolve against: whatever its
 * `useTranslation(...)` binds, falling back to i18n/config.ts's
 * `defaultNS: 'common'` when a file has none (e.g. a helper handed a `t`).
 * A file-wide union is deliberately coarse — several hooks in one file all
 * contribute — but it never reports a call site that any of them can serve.
 */
const DEFAULT_NS = "common";
const USE_TRANSLATION = /useTranslation\(\s*(\[[^\]]*\]|['"][^'"]*['"])/g;
function boundNamespaces(src) {
  const found = new Set();
  for (const m of src.matchAll(USE_TRANSLATION))
    for (const s of m[1].matchAll(/['"]([^'"]+)['"]/g)) found.add(s[1]);
  return found.size ? [...found] : [DEFAULT_NS];
}

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "locales" || entry.startsWith("."))
      continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* sourceFiles(full);
    else if (SOURCE_EXT.test(entry) && !SKIP_FILE.test(entry)) yield full;
  }
}

/**
 * `t('key', 'Default')` / `t("key", "Default")`, tolerating a line break
 * between the arguments. Only a STRING second argument is a defaultValue —
 * `t('key', { count })` is options and is skipped by the trailing quote.
 */
const T_CALL_WITH_DEFAULT =
  /\bt\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*['"]/g;

const undeclared = [];
for (const file of sourceFiles(SRC_DIR)) {
  const src = readFileSync(file, "utf8");
  const fileNamespaces = boundNamespaces(src);
  for (const m of src.matchAll(T_CALL_WITH_DEFAULT)) {
    const raw = m[2];
    if (!raw) continue;
    // `t('ns:some.key', …)` names its namespace explicitly and resolves there
    // only; a bare key resolves against whatever the file's hooks bind.
    const colon = raw.indexOf(":");
    const nsCandidates = colon === -1 ? fileNamespaces : [raw.slice(0, colon)];
    const key = colon === -1 ? raw : raw.slice(colon + 1);
    if (!key || nsCandidates.some((ns) => isDeclaredIn(ns, key))) continue;
    const line = src.slice(0, m.index).split("\n").length;
    undeclared.push({
      // Baselined by KEY, not location — moving a call site must not read as
      // a new offence, and the key is what has to be translated anyway.
      key: raw,
      where: `${file.slice(repoRoot.length + 1)}:${line} → t('${raw}', …) [ns: ${nsCandidates.join("|")}]`,
    });
  }
}

/*
 * The admin app carried a long tail of these from before the guard existed, so
 * — same convention as check-i18n-value-drift.mjs — a committed baseline
 * recorded the known offenders and only NEW keys blocked. That backlog has
 * since been translated and the baseline is EMPTY: every offence now fails the
 * gate. Keep it that way — translate the key in all five locales, or point the
 * call site at one that exists. `--write-baseline` still exists for a
 * deliberate, reviewed amnesty, but re-filling it re-opens the hole.
 */
const BASELINE_PATH = join(repoRoot, "scripts/i18n-undeclared-default-baseline.json");
const undeclaredKeys = [...new Set(undeclared.map((u) => u.key))].sort();

if (process.argv.includes("--write-baseline")) {
  writeFileSync(BASELINE_PATH, JSON.stringify(undeclaredKeys, null, 2) + "\n");
  console.log(
    `✓ wrote undeclared-defaultValue baseline (${undeclaredKeys.length} key(s))`,
  );
  process.exit(failed ? 1 : 0);
}

let baseline = [];
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch {
  console.error(
    `✗ ${BASELINE_PATH} not found — generate it with: node scripts/check-i18n-parity.mjs --write-baseline`,
  );
  process.exit(1);
}
const known = new Set(baseline);
const fresh = undeclared.filter((u) => !known.has(u.key));

if (fresh.length === 0) {
  console.log(
    `✓ i18n defaults: no NEW t() defaultValue whose key is absent from every locale` +
      (baseline.length ? ` (${baseline.length} baselined)` : ""),
  );
} else {
  failed = true;
  console.error(
    `✗ i18n undeclared defaultValue — ${fresh.length} NEW call site(s) whose key exists in NO locale file, so the English defaultValue renders for every language:`,
  );
  for (const line of [...new Set(fresh.map((u) => u.where))].sort())
    console.error(`  ${line}`);
  console.error(
    `\nDeclare each key in frontend/src/i18n/locales/*/ (ALL locales, not just en), or point the call site at a key that already exists.`,
  );
}

process.exit(failed ? 1 : 0);

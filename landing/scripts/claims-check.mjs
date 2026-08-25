#!/usr/bin/env node
/**
 * Build gate: refuse to ship a marketing claim we cannot support.
 *
 * Every rule below corresponds to a claim that was published, audited against
 * backend/frontend source, found to be false or unverifiable, and removed. The
 * check exists because the failure mode is silent: a claim reintroduced during
 * a copy edit or a content port looks like ordinary prose, ships to five
 * locales at once, and gets quoted back with the brand attached by whatever
 * answer engine read the page.
 *
 * Each rule carries the evidence that retired it. If a rule ever becomes wrong
 * because the product gained the capability, delete the rule in the same commit
 * that ships the capability — never to make a build pass.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const messagesDir = join(root, 'src/i18n/messages');

/** @type {{id:string, why:string, retired:string, pattern:RegExp}[]} */
const RULES = [
  {
    id: 'uptime-sla',
    retired: "%99.9 Çalışma Süresi SLA",
    why: 'No uptime measurement and no status page exist; the distance-sales contract commits to %99,5, not %99.9.',
    pattern: /99[.,]9\s*%|%\s*99[.,]9/i,
  },
  {
    id: 'unlimited-branches',
    retired: "Sınırsız marka ve şube",
    why: 'free-baseline.const.ts sets maxBranches: 1, enforced in branches.service.ts; each extra branch is a 3.990/yr SKU.',
    pattern: /(sınırsız[^.\n]{0,40}şube|şube[^.\n]{0,40}sınır(ı yok|ı bulunmaz|sız)|unlimited[^.\n]{0,40}branch|branch[^.\n]{0,30}limits?\b[^.\n]{0,20}(no|none)|без лимита[^.\n]{0,30}филиал|cheksiz[^.\n]{0,30}filial|فروع بلا حدود)/i,
  },
  {
    id: 'allergen',
    retired: "Alerjen ve diyet bilgisi gösterimi",
    why: 'No allergen or dietary field exists in prisma/schema.prisma, backend/src or frontend/src.',
    pattern: /alerjen|allergen|аллерген|alergen|الحساسية|مسبّبات الحساسية/i,
  },
  {
    id: 'fabricated-traction',
    retired: "{\"restaurantCount\": \"500+\", \"orderCount\": \"10K+\", \"totalRevenue\": \"₺1M+\"}",
    why: 'stats.json was a fallback file; fetch-stats.js rewrote a real zero as "500+". There are no published traction numbers.',
    pattern: /\b500\+|\b10K\+|₺\s?1M\+/,
  },
  {
    id: 'outcome-metrics',
    retired: "%40 daha hızlı sipariş işleme",
    why: 'The %40 / %85 / %25 / 12-min figures were hardcoded literals attributed to customers, with no measurement source.',
    pattern: /%\s?(40|85|25)\s*(daha|less|faster|higher|более|kam|أسرع)|(40|85|25)\s?%\s*(faster|fewer|higher|less)/i,
  },
  {
    id: 'multi-currency',
    retired: "Çoklu dil, çoklu para birimi desteği.",
    why: 'Pricing and payments run in TRY for the Turkish market; there is no multi-currency surface on the landing product.',
    pattern: /çoklu para birimi|multi-?currency|мультивалют|ko‘p valyuta|تعدّد العملات/i,
  },
  {
    id: 'full-compliance',
    retired: "Avrupa ve Türk veri koruma düzenlemelerine tam uyumluluk.",
    why: 'No certification or audit backs a "full compliance" claim, and SECURITY_LEAKED_SECRETS_RUNBOOK.md is still OPEN.',
    pattern: /tam uyumlu(luk)?|full(y)? compliant|полное соответствие|to‘liq muvofiq|امتثال كامل/i,
  },
  {
    id: 'custom-domain',
    retired: "özel alan adı bile bağlayabilirsiniz",
    why: 'Tenant carries `subdomain String? @unique`; there is no custom-domain or CNAME path anywhere in backend/src.',
    pattern: /özel alan adı|custom domain|собственн\w*\s+домен|maxsus domen|نطاق مخصّص/i,
  },
  {
    id: 'encryption-at-rest-everything',
    retired: "Tüm veriler, endüstri standardı AES-256 şifreleme kullanılarak aktarımda ve depolamada şifrelenir.",
    why: 'AES-256-GCM covers specific credential columns only (encryption.helper.ts); the database volume is not encrypted at rest.',
    pattern: /tüm veriler[^.\n]{0,90}depolamada[^.\n]{0,30}şifrelen|all data[^.\n]{0,90}(at rest|in storage)[^.\n]{0,25}encrypted/i,
  },
  {
    id: 'tip-distribution',
    retired: "Otomatik bahşiş hesaplama ve dağıtımı",
    why: 'Payment.tipAmount is captured and aggregated in reports; no tip pool, split or payout exists.',
    pattern: /bahşiş[^.\n]{0,30}dağıtım|tip[^.\n]{0,20}distribut|распределение чаевых/i,
  },
  {
    id: 'menu-content-translation',
    retired: "Menünüz Türkçe, İngilizce, Rusça, Arapça ve Özbekçe görüntülenebilir",
    why: 'Product.name/description are single Strings with no translation model; only the guest interface is localised.',
    pattern: /menü(nüz)?[^.\n]{0,40}(türkçe|ingilizce)[^.\n]{0,60}görüntülenebilir|menus? (in|available in) (turkish|five languages)[^.\n]{0,40}(item|product)/i,
  },
];

/**
 * Each rule's `retired` field is the exact string that used to ship on the
 * site before the audit removed it. Before scanning anything, every rule is
 * tested against its own retired claim. A rule that no longer catches the
 * sentence it was written for is a rule that silently stopped protecting
 * anything — that is a build failure, not a warning.
 */
function selfTest() {
  const broken = RULES.filter((r) => !r.pattern.test(r.retired));
  if (broken.length) {
    console.error('\nclaims-check SELF-TEST FAILED — rule(s) no longer match the claim they retired:\n');
    for (const r of broken) {
      console.error(`  [${r.id}] pattern does not match: ${JSON.stringify(r.retired)}`);
    }
    console.error('\nFix the pattern. Do not delete the fixture.\n');
    process.exit(1);
  }
}

selfTest();

function walk(value, path, out) {
  if (typeof value === 'string') out.push([path, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, out);
}

const targets = [];
for (const file of readdirSync(messagesDir).filter((f) => f.endsWith('.json'))) {
  const strings = [];
  walk(JSON.parse(readFileSync(join(messagesDir, file), 'utf8')), '', strings);
  targets.push(...strings.map(([p, v]) => [`messages/${file}:${p}`, v]));
}
targets.push(['public/llms.txt', readFileSync(join(root, 'public/llms.txt'), 'utf8')]);

const violations = [];
for (const [where, text] of targets) {
  for (const rule of RULES) {
    const m = text.match(rule.pattern);
    if (m) violations.push({ where, rule, excerpt: m[0] });
  }
}

if (violations.length) {
  console.error(`\nclaims-check FAILED — ${violations.length} unsupported claim(s):\n`);
  for (const v of violations) {
    console.error(`  [${v.rule.id}] ${v.where}`);
    console.error(`      matched: ${JSON.stringify(v.excerpt)}`);
    console.error(`      why:     ${v.rule.why}\n`);
  }
  console.error('If the product now genuinely supports one of these, delete that rule');
  console.error('in the same commit that ships the capability — not to make a build pass.\n');
  process.exit(1);
}

console.log(`claims-check OK (${RULES.length} rules, ${targets.length} sources)`);

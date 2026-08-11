export const meta = {
  name: 'hardware-doc-verify',
  description: 'Read-only adversarial verification of docs/hardware device manuals: code-grounding + TR regulation fact-check + coverage gaps',
  phases: [
    { title: 'Verify' },
    { title: 'Adversarial' },
    { title: 'Coverage' },
  ],
}

// One entry per device manual. The framework doc (00) carries most regulation.
const DOCS = [
  { file: 'docs/hardware/00-genel-cerceve.md', topic: 'Ortak çerçeve: TR yatay regülasyon (7223 ürün güvenliği, CE/RoHS/AEEE-WEEE, EÇBS üretici kaydı), 6502 TKHK/mesafeli satış/cayma, KVKK/VERBİS, PCI, mali mevzuat (YN ÖKC zorunluluğu, GMP-3, e-Fatura/e-Arşiv), garanti/RMA, ortak pairing standardı' },
  { file: 'docs/hardware/01-yazarkasa-okc.md', topic: 'YN ÖKC yazarkasa: Hugin Tiger T300 4G, Beko 300TR, Ingenico Move/5000F; GİB onay listesi, mali fiş vs bilgi fişi, Z/X raporu, QUOTE_ONLY satış tier' },
  { file: 'docs/hardware/02-fis-mutfak-yazici.md', topic: 'Termal ESC/POS yazıcı: Epson TM-T20III (LAN), TM-T88VI (Ethernet), Star TSP143IIIBI (BT); mali DEĞİL, köprü-arkası raw-TCP 9100, termal kağıt BPA/gıda-temas' },
  { file: 'docs/hardware/03-kds-ekrani.md', topic: 'KDS ekran: Sunmi D2s (PoE Android), PENETEK 15.6" IP65 panel PC; IP koruma sınıfı, PoE güvenlik, provizyonlu bearer token 24h TTL' },
  { file: 'docs/hardware/04-tablet.md', topic: 'Tablet: Sunmi V2 Pro (yazıcılı el terminali, adisyon/bilgi fişi — mali DEĞİL), Samsung Galaxy Tab A9+ (SM-X210/SM-X216); kiosk/MDM, cloud-direct provizyon' },
  { file: 'docs/hardware/05-barkod-okuyucu.md', topic: 'Barkod/QR okuyucu: Honeywell Voyager 1450g, Zebra DS2208; USB-HID keyboard-wedge, host-üzerinden provizyon' },
  { file: 'docs/hardware/06-arayan-numara.md', topic: 'Caller ID: Cidshow CID602 2-hat; FSK/DTMF, HMAC-imzalı webhook, caller eklenti gate, PSTN/analog hat regülasyonu' },
  { file: 'docs/hardware/07-para-cekmecesi.md', topic: 'Para çekmecesi: AFANDA LB-405K; kendi Device.kind yok — printer cash_drawer capability, RJ11 drawer-kick 12V solenoid, CashDrawerService' },
  { file: 'docs/hardware/08-network-bridge-hummybox.md', topic: 'HummyBox Lite/Pro local bridge; sadece giden bağlantı (WSS + raw-TCP 9100), ESC/POS-only driver, 30 günlük bearer token /v1/bridges/claim provizyon' },
  { file: 'docs/hardware/09-pos-terminal.md', topic: 'Kart ödeme terminali: bank_ecr/softpos/gmp3_card/simulator; Ödemeye Geç→KART yalnız ONAY’da Payment, charge_card NON_RETRYABLE, PCI PTS/EMV, PARTNER_REDIRECT tier' },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['docFile', 'section', 'claim', 'category', 'verdict', 'severity', 'evidence', 'recommendation'],
        properties: {
          docFile: { type: 'string' },
          section: { type: 'string', description: 'Section header or heading the claim sits under' },
          claim: { type: 'string', description: 'The specific claim being checked (short paraphrase or quote)' },
          category: { type: 'string', enum: ['code', 'regulation', 'spec', 'consistency', 'gap'] },
          verdict: { type: 'string', enum: ['CONFIRMED', 'REFUTED', 'INACCURATE', 'OUTDATED', 'UNVERIFIABLE'] },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'info'] },
          evidence: { type: 'string', description: 'What you found: repo path+line for code, or source/URL for regulation' },
          sourceOrPath: { type: 'string', description: 'repo path:line, or authoritative URL' },
          recommendation: { type: 'string', description: 'Concrete fix or wording change' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['stillReal', 'confidence', 'reasoning'],
  properties: {
    stillReal: { type: 'boolean', description: 'true if the finding survives skeptical re-check (the doc really is wrong)' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    reasoning: { type: 'string' },
    correctedRecommendation: { type: 'string' },
  },
}

phase('Verify')

// For each doc, two independent verifiers run concurrently:
//  - code: greps the actual repo to confirm/refute architecture/spec/consistency claims
//  - reg : web-verifies Türkiye-specific regulatory/compliance claims (2026-current)
const verifyTasks = DOCS.flatMap((d) => [
  { d, mode: 'code' },
  { d, mode: 'reg' },
])

const codePrompt = (d) => `You are a meticulous technical fact-checker for a restaurant POS/KDS SaaS repo (root: /home/tarik/Projects/kds).

Read the device manual at: ${d.file}
Its topic: ${d.topic}

Your job: verify every CODE-GROUNDED, ARCHITECTURE, TECHNICAL-SPEC, and INTERNAL-CONSISTENCY claim against the ACTUAL repository. Do NOT trust the doc — check it.

How to verify:
- Use Grep/Glob/Read/Bash to inspect real source. Key areas: backend/src/modules/device-mesh, backend/src/modules/payment-terminal, backend/src/modules/caller, backend/prisma/schema.prisma, backend/prisma/seeds/seed-marketplace.ts, apps/local-bridge-agent, apps/kds-kiosk, frontend/src/features/hardware-store, frontend/src/types/hardware.ts.
- Cross-check product facts (price, warrantyMonths, model, brand, SKU, category, requiredAddOn, gibCertified, rentalMonthlyCents) against seed-marketplace.ts — the doc must match the seed exactly.
- Check device-mesh claims: pairCode format/length, token TTL, whether heartbeat extends TTL, sha256 token hashing, provisioning idempotency, sale tiers (QUOTE_ONLY / PARTNER_REDIRECT / DIRECT_SALE / RECOMMENDED_ONLY), Device.kind values and capability tags.
- Check bridge/printer claims: outbound-only, raw-TCP port 9100, ESC/POS vs Star Line Mode, which drivers are actually implemented vs stubbed.
- Check payment-terminal claims: provider ids (gmp3_card/bank_ecr/softpos/simulator), charge_card/void_card NON_RETRYABLE classification, "only writes Payment on approval", NEEDS_REVIEW reconciliation.
- Check cash-drawer modeling: no own Device.kind, printer cash_drawer capability, CashDrawerService, drawer-kick.

For EACH claim you checked, if it is wrong, imprecise, or unverifiable, emit a finding. If a claim is CONFIRMED and important, you may also emit it (verdict CONFIRMED, severity info) so we know it was checked — but prioritize problems. Ground every finding in a real repo path:line in sourceOrPath. Severity: blocker = actively misleads an installer/seller into a broken/non-compliant setup; major = materially wrong technical/spec/price claim; minor = imprecise wording; info = confirmed-correct spot-check.

Return ONLY the structured findings. Your text output is data, not a message.`

const regPrompt = (d) => `You are a Türkiye regulatory & compliance fact-checker for restaurant electronics sold to businesses.

Read the device manual at: ${d.file} (root: /home/tarik/Projects/kds).
Its topic: ${d.topic}

Your job: extract every TÜRKİYE-SPECIFIC regulatory / legal / compliance / tax claim and verify it against CURRENT (2026) authoritative sources. Use web search (prefer official/primary sources).

Claims to scrutinize (only those the doc actually makes):
- GİB Yeni Nesil ÖKC (yazarkasa) zorunluluğu, onay/lisans listesi, GMP-3 protokolü, mali fiş vs bilgi fişi, Z/X raporu, e-Fatura/e-Arşiv eşikleri and any cited dates/thresholds.
- 7223 sayılı Ürün Güvenliği ve Teknik Düzenlemeler Kanunu; CE işareti; RoHS; EMC/LVD.
- AEEE/WEEE (Atık Elektrikli ve Elektronik Eşya Yönetmeliği), üretici/ithalatçı kaydı, EÇBS portalı — verify the CURRENT regulation name/date and registration mechanism.
- 6502 sayılı TKHK: mesafeli satış, cayma hakkı (B2B tacir istisnası vs tüketici), garanti belgesi süreleri, satış sonrası hizmet.
- KVKK: veri sorumlusu/işleyen, aydınlatma/açık rıza, VERBİS kayıt eşikleri (çalışan sayısı / mali bilanço) — verify current thresholds.
- PCI-DSS / PCI PTS, EMV L1/L2, BKM/TR ödeme regülasyonu for card terminals & SoftPOS.
- Termal kağıt BPA/BPS ve gıda-temas/hijyen (if claimed).
- PSTN/analog hat / Caller ID for phone-order (BTK context) if claimed.
- TSE/gümrük/ithalat if claimed.

For each claim: state whether it is CONFIRMED, INACCURATE, OUTDATED, or UNVERIFIABLE, with an authoritative source URL in sourceOrPath. Flag any cited threshold/date/law-number that is wrong or stale. A wrong compliance claim in a sales manual is high severity (blocker/major). If the doc already hedges a claim as "(resmi kaynaktan teyit edilmeli)", that lowers severity but still verify and report the correct value where you can.

Return ONLY the structured findings. Your text output is data, not a message.`

const verifyResults = await parallel(
  verifyTasks.map((t) => () =>
    agent(t.mode === 'code' ? codePrompt(t.d) : regPrompt(t.d), {
      label: `${t.mode}:${t.d.file.replace('docs/hardware/', '').replace('.md', '')}`,
      phase: 'Verify',
      schema: FINDINGS_SCHEMA,
      effort: t.mode === 'reg' ? 'high' : 'high',
    }).then((r) => (r && r.findings ? r.findings : []))
  )
)

const allFindings = verifyResults.filter(Boolean).flat()

// Adversarial pass: only re-check the ones that would change the docs (real problems).
const suspect = allFindings.filter(
  (f) => ['REFUTED', 'INACCURATE', 'OUTDATED'].includes(f.verdict) && ['blocker', 'major'].includes(f.severity)
)

phase('Adversarial')
log(`${allFindings.length} raw findings; adversarially re-checking ${suspect.length} high-severity problems`)

const verified = await parallel(
  suspect.map((f, i) => () =>
    agent(
      `You are a SKEPTIC. Another agent claims this restaurant-hardware manual has a defect. Default to REJECTING the finding unless you can independently confirm it is really wrong.

Doc: ${f.docFile}
Section: ${f.section}
Claim in doc: ${f.claim}
Alleged problem (verdict ${f.verdict}, ${f.severity}): ${f.evidence}
Cited source/path: ${f.sourceOrPath}
Proposed fix: ${f.recommendation}

Re-verify INDEPENDENTLY: for code claims, open the cited repo path (root /home/tarik/Projects/kds) and read it yourself; for regulation claims, check an authoritative source yourself. Decide if the doc is genuinely wrong. If the original finding is itself mistaken (the doc was actually correct), set stillReal=false. If real, refine the corrected recommendation.

Return ONLY the structured verdict.`,
      { label: `skeptic:${i}`, phase: 'Adversarial', schema: VERDICT_SCHEMA, effort: 'high' }
    ).then((v) => ({ finding: f, verdict: v }))
  )
)

const confirmedProblems = verified
  .filter(Boolean)
  .filter((x) => x.verdict && x.verdict.stillReal)
  .map((x) => ({ ...x.finding, adversarial: x.verdict }))

// Findings that didn't need adversarial re-check (confirmed-correct spot checks, minors, gaps)
const otherFindings = allFindings.filter((f) => !suspect.includes(f))

phase('Coverage')

const coverage = await agent(
  `You are a coverage/gap critic for a device-manual set at docs/hardware/ (root /home/tarik/Projects/kds).

Determine whether the manual set covers EVERY electronic device the platform actually SELLS or PROVISIONS, and whether any required section is missing.

Do this:
1. Read the authoritative catalog: backend/prisma/seeds/seed-marketplace.ts (the PRODUCTS array = sold hardware SKUs; also SERVICES). List every SKU + category.
2. Read frontend/src/types/hardware.ts and backend/prisma/schema.prisma for device-mesh Device.kind values and sale tiers (QUOTE_ONLY/DIRECT_SALE/PARTNER_REDIRECT/RECOMMENDED_ONLY) and payment-terminal provider kinds.
3. Read docs/hardware/README.md + the section headers of each 0X doc.
4. Report: (a) any sold/provisioned device class NOT documented (gap, severity per how sellable it is); (b) any doc covering a device NOT in the catalog (stale); (c) any of the standard 11 sections missing from a doc; (d) price/warranty/model mismatches between README/docs and the seed; (e) the "not covered: tartı/metroloji, RECOMMENDED_ONLY" note — confirm whether the platform actually references weighing/scale devices anywhere (grep), i.e. is that gap real and should it be documented.

Emit findings (category 'gap' or 'consistency'). Ground each in a repo path. Return ONLY structured findings.`,
  { label: 'coverage-critic', phase: 'Coverage', schema: FINDINGS_SCHEMA, effort: 'high' }
).then((r) => (r && r.findings ? r.findings : []))

return {
  summary: {
    rawFindings: allFindings.length,
    adversariallyChecked: suspect.length,
    confirmedProblems: confirmedProblems.length,
    coverageFindings: coverage.length,
  },
  confirmedProblems,
  coverageFindings: coverage,
  otherFindings,
}

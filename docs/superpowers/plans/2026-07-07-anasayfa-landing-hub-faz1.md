# HummyTummy Landing Hub — Faz 1 Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Mevcut `/` ana sayfasını, verilen voxel marka görsellerini kullanan kapsamlı bir ana sayfaya dönüştürmek + ortak `MarketingLayout` + gerçek fiyatlı `/fiyatlandirma` sayfası.

**Architecture:** Yeni `src/marketing/` altında ortak layout (mega-menü nav + site-haritası footer) + veri dosyaları + sunumsal bileşenler. `LandingPage.tsx` bunları kullanarak 17 bölümü kompoze eder. Görseller `sharp` ile webp'e optimize edilip `public/marketing/`'e üretilir. Rotalar `lazyWithReload` ile eklenir.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind 3 (arbitrary values) + react-router-dom v6 + lucide-react + vitest/testing-library. Görsel opt: `sharp` (transitive, resolvable — package.json'a EKLEME).

## Global Constraints

- **Dil:** Türkçe, hard-coded (mevcut `LandingPage.tsx` deseni; i18n yok).
- **Marka:** krem `#faf6f0`, mürekkep `#1c1917`, turuncu `#f97316`/hover `#ea580c`, turuncu-tint `#fff3e8`, kenar `#ece2d4`; başlık `Fraunces`, gövde `Inter`.
- **Commit/PR:** AI/Claude izi YOK. Conventional commit. Branch `feat/anasayfa-landing-hub`.
- **Rota konvansiyonu:** yeni sayfalar `lazyWithReload` (React.lazy DEĞİL).
- **Görsel seçimi:** DAİMA gerçek içeriğe göre (dosya adları yanıltıcı — spec §2). `Kafe_Ortam_Kurulum` (TavernHero/₹) ve `Kahve_Barista_Latte` (app-store afişi) KULLANILMAZ.
- **Dürüstlük (spec §7 — sayfa metnine zorunlu):** kart-terminali tahsilatı YOK · KDS istasyon-yönlendirme YOK · AI OCR/3D "mevcut" DEME · e-Fatura=Paraşüt/Foriba/Logo entegrasyonu · uptime % YAZMA · analiz kural-tabanlı ("AI" deme) · menü içeriği oto-çevrilmez · uydurma müşteri sayısı/yorum/logo YOK · native mobil app ima etme.
- **Auth davranışı:** `/` giriş-yapmışsa `/dashboard`'a yönlenir (korunur).
- **Verify her task:** `npx tsc --noEmit` temiz + `npm run test:ci -- <dosya>` yeşil. Faz sonunda: `npm run lint`, `npm run build`, Playwright görsel QA (375/768/1280).

---

### Task 1: Marka teması + görsel optimizasyon + görsel veri haritası

**Files:**
- Create: `frontend/scripts/optimize-marketing-images.mjs`
- Create (generated): `frontend/public/marketing/*.webp`
- Create: `frontend/src/marketing/theme.ts`
- Create: `frontend/src/marketing/data/images.ts`
- Test: `frontend/src/marketing/data/images.test.ts`

**Interfaces produced:**
- `theme.ts`: `export const C = {...hex}`, `export const display = { fontFamily: '"Fraunces", Georgia, serif' } as const`
- `images.ts`: `export type Img = { src: string; srcSm: string; alt: string; w: number; h: number; kind: 'scene'|'cutout' }` ; `export const IMG: Record<ImgKey, Img>` ; `export type ImgKey = 'heroTablet'|'mascot'|'posTerminal'|'qrStand'|'kdsChef'|'kdsCooking'|'posChef'|'mascotServe'|'deliveryScooter'|'deliveryCity'|'reportPhone'|'chartIcon'|'analytics'|'cloudNetwork'|'cloudServers'|'dioramaInterior'|'dioramaBuilding'|'shield'|'mascotShield'|'supportAgent'`

- [ ] **Step 1: `optimize-marketing-images.mjs`** — sharp ile her kaynak PNG'i 2 genişlikte webp'e çevir (`lg`=1200, `sm`=560, quality 78), `public/marketing/<key>-{lg,sm}.webp`'e yaz. Kaynak→key eşlemesi (spec §2 gerçek içerik):
  `Tatli_Menu_Cikolata→heroTablet`, `Musteri_Destek_Sef→mascot`, `Dijital_Menu_Yonetimi→posTerminal`, `Premium_Guvenlik_Kalkan→qrStand`, `Restoran_Ic_Mekan→kdsChef`, `Fatura_Odeme_Sistemi→kdsCooking`, `Rapor_Dokuman_Analiz→posChef`, `Sef_Tablet_Siparis→mascotServe`, `Menu_Yonetimi_Yemek→deliveryScooter`, `Gelir_Buyume_Grafik→deliveryCity`, `Satis_Analiz_Dashboard→reportPhone`, `Satis_Komisyon_Gelir→chartIcon`, `Veri_Guvenligi_SSL→analytics`, `Sef_Laptop_POS→cloudNetwork`, `Siparis_Takip_Tablet→cloudServers`, `Mutfak_Ekrani_KDS→dioramaInterior`, `QR_Menu_Mobil_Uygulama→dioramaBuilding`, `Hesap_Guvenlik_Kilit→shield`, `Hosgeldin_Sef_Karakter→mascotShield`, `Kar_Buyume_Para→supportAgent`. Script her çıktının gerçek boyutunu (`w,h`) stdout'a JSON basar (images.ts'e girer).
- [ ] **Step 2: Çalıştır** — `cd frontend && node scripts/optimize-marketing-images.mjs` → `public/marketing/` dolu; boyut JSON'unu al.
- [ ] **Step 3: `theme.ts`** yaz (yukarıdaki C + display).
- [ ] **Step 4: `images.ts`** yaz — her key için `{ src:'/marketing/<key>-lg.webp', srcSm:'/marketing/<key>-sm.webp', alt:'<TR açıklama>', w, h, kind }`. `kind:'scene'` = çerçevele; `kind:'cutout'` = doğrudan. (mascot, shield, mascotShield, chartIcon, analytics, cloudNetwork, cloudServers, dioramaInterior, dioramaBuilding, deliveryScooter, reportPhone, supportAgent = cutout; diğerleri scene.)
- [ ] **Step 5: `images.test.ts`** — her `IMG[key]` için `fs.existsSync('public'+src)` ve `alt.length>0` doğrula. Run `npm run test:ci -- images` → PASS.
- [ ] **Step 6: Commit** `feat(landing): görsel optimizasyon + marka teması + görsel haritası`

---

### Task 2: Pazarlama verileri (plans, modules, trust, sectors, faq)

**Files:** Create `frontend/src/marketing/data/{plans,modules,trust,sectors,faq}.ts` ; Test `frontend/src/marketing/data/plans.test.ts`, `modules.test.ts`

**Interfaces produced:**
- `plans.ts`: `export type Plan={ key:'TRIAL'|'BASIC'|'PRO'|'BUSINESS'; name:string; tagline:string; monthly:number|null; yearly:number|null; purchasable:boolean; highlight?:boolean; limits:Record<string,number|'∞'>; features:Record<FeatureKey,boolean> }`; `export const PLANS:Plan[]`; `export const FEATURE_ROWS:{key:FeatureKey;label:string}[]`; `export const LIMIT_ROWS:{key:string;label:string}[]`
- `modules.ts`: `export type Module={ slug:string; anchor:string; title:string; tagline:string; icon:LucideIcon; imageKey:ImgKey; bullets:string[] }`; `export const MODULES:Module[]` (8)
- `trust.ts`: `export const TRUST:{icon:LucideIcon;label:string}[]`
- `sectors.ts`: `export const SECTORS:{title:string;emoji:string;anchor:string}[]`
- `faq.ts`: `export const FAQ:{q:string;a:string}[]`

- [ ] **Step 1: `plans.ts`** — spec §6 GERÇEK değerler: TRIAL(0/0,∞), BASIC(499/4490; users5 tables20 branches1 products100 orders500), PRO(1299/12990; 15/50/3/500/2000), BUSINESS(2999/29990,∞). features: posAccess/kdsIntegration/inventoryTracking = tüm true; advancedReports/reservationSystem/personnelManagement/deliveryIntegration/multiLocation/customBranding/prioritySupport = TRIAL/PRO/BUSINESS true, BASIC false; apiAccess/externalDisplay = TRIAL/BUSINESS true, BASIC/PRO false. PRO `highlight:true`. taglines spec §6.
- [ ] **Step 2: `modules.ts`** — 8 modül (spec §5 & Task-plan üstü liste): qr-menu/pos-odeme/mutfak-ekrani-kds/masa-siparis/stok-envanter/raporlar/coklu-sube/entegrasyonlar; her biri lucide icon + imageKey + 3-4 dürüst bullet.
- [ ] **Step 3: `trust.ts`** — 6 öğe: 5 dilli QR menü, 7/24 bulut erişim, AES-256 şifreleme, KVKK uyumlu, 4 teslimat platformu, Türkçe destek (lucide ikonlarla).
- [ ] **Step 4: `sectors.ts`** — Restoran/Kafe/Bar/Pastane/Fast Food/Pizza/Şubeli/Bulut Mutfak (emoji + anchor).
- [ ] **Step 5: `faq.ts`** — 7 esaslı soru (kurulum yok, hangi cihaz, 7 gün deneme sonrası, teslimat platformları, e-Fatura, güvenlik, çoklu şube). Cevaplar dürüst (spec §7).
- [ ] **Step 6: Tests** — `plans.test.ts`: 4 plan, `PLANS[1].monthly===499`, `PRO.monthly===1299`, `BUSINESS.monthly===2999`, BASIC.features.advancedReports===false, PRO.features.apiAccess===false, BUSINESS.features.apiAccess===true. `modules.test.ts`: 8 modül, slug'lar unique, her imageKey `IMG`'de var. Run PASS.
- [ ] **Step 7: Commit** `feat(landing): plan matrisi + modül/güven/sektör/SSS verileri`

---

### Task 3: Sunumsal primitifler

**Files:** Create `frontend/src/marketing/components/{Section,SplitFeature,FramedShot,MascotFrame,Badge}.tsx` ; Test `frontend/src/marketing/components/FramedShot.test.tsx`

**Interfaces produced:**
- `Section({id?,eyebrow?,title?,subtitle?,children,className?})` — `max-w-6xl` sarmalayıcı + Fraunces başlık.
- `SplitFeature({reverse?,eyebrow,title,children,image}: {image:ImgKey}...)` — sol/sağ dönüşümlü grid; `image` scene ise `FramedShot`, cutout ise `MascotFrame`.
- `FramedShot({img}:{img:ImgKey})` — sahne görseli cihaz-çerçevesinde (`rounded-2xl border shadow-2xl`, browser-dot başlık), `loading="lazy" decoding="async" width height`, `<img srcSet>` sm/lg.
- `MascotFrame({img,glow?}:{img:ImgKey})` — cutout görsel + radyal glow + drop-shadow.
- `Badge({children})` — turuncu-tint pill.

- [ ] **Step 1–5:** Bileşenleri yaz (design system spec §3; `prefers-reduced-motion` uyumu; `alt` IMG'den). `FramedShot.test.tsx`: `render(<FramedShot img="posTerminal"/>)` → `getByAltText` IMG.posTerminal.alt bulunur, img `loading=lazy`.
- [ ] **Step 6: Commit** `feat(landing): sunumsal primitifler (Section/Split/FramedShot/Mascot)`

---

### Task 4: MarketingNav + Footer + Layout

**Files:** Create `frontend/src/marketing/components/{MarketingNav,MarketingFooter}.tsx`, `frontend/src/marketing/MarketingLayout.tsx` ; Test `frontend/src/marketing/MarketingLayout.test.tsx`

**Interfaces produced:** `MarketingLayout({children})`; nav = sticky, logo + Özellikler ▾ (MODULES mega-menü, Faz1 `/#${anchor}`) + Çözümler ▾ (SECTORS) + Fiyatlar (`/fiyatlandirma`) + Giriş (`/login`) + **7 Gün Ücretsiz Dene** (`/register`); footer = site-haritası (modüller, yasal `/privacy`,`/terms`,`/legal/kvkk`, help/developer, © yıl).

- [ ] **Step 1–3:** Nav (mobil hamburger + masaüstü mega-menü), Footer, Layout yaz. Router `<Link>`/`<a href="/#...">`.
- [ ] **Step 4: Test** — `MemoryRouter` içinde render; "7 Gün Ücretsiz Dene" ve footer'da "Gizlilik" linki (`/privacy`) bulunur. PASS.
- [ ] **Step 5: Commit** `feat(landing): mega-menü nav + site-haritası footer + MarketingLayout`

---

### Task 5: Ana sayfa bölüm blokları + LandingPage kompozisyonu

**Files:** Create `frontend/src/marketing/components/{TrustStrip,ModuleCard,ModuleGrid,IntegrationChips,SectorGrid,Faq,CtaBand,HowItWorks,PlanTeaser}.tsx` ; Modify `frontend/src/pages/LandingPage.tsx` (tam yeniden yazım) ; Test `frontend/src/pages/LandingPage.test.tsx`

**Interfaces consumed:** IMG, MODULES, TRUST, SECTORS, FAQ, PLANS, C, display, tüm primitifler + MarketingLayout.

- [ ] **Step 1:** Blok bileşenleri yaz: `TrustStrip` (TRUST), `ModuleCard`+`ModuleGrid` (9 kart: 8 MODULES + Güvenlik `/#guvenlik`; link Faz1 `/#anchor`), `IntegrationChips` (Yemeksepeti/Getir/Trendyol Yemek/Migros Yemek — stilize çip, sahte logo yok), `SectorGrid`, `Faq` (accordion), `CtaBand` (koyu + grain), `HowItWorks`, `PlanTeaser` (PLANS özet + gerçek fiyat + `/fiyatlandirma` link).
- [ ] **Step 2:** `LandingPage.tsx` yeniden yaz — `useAuthStore` redirect + `document.title` KORU; `<MarketingLayout>` içinde spec §5'teki 17 bölümü sırayla kompoze et (hero → trust → 3 fayda → modül grid → 3 amiral spotlight (SplitFeature, id=anchor) → teslimat → rapor → çoklu-şube → güvenlik(id=guvenlik) → sektör → itiraz → plan teaser → destek → SSS → CTA). Kopya spec §5; dürüstlük spec §7.
- [ ] **Step 3: Test** — `LandingPage.test.tsx`: auth yokken render; hero başlığı, 9 modül kartı (getAllByRole link/heading), "Fiyatlandırma"/plan teaser, SSS ilk sorusu görünür; auth token'lı store ile `<Navigate>` (redirect) — mock `useAuthStore`. PASS.
- [ ] **Step 4: `tsc --noEmit`** temiz.
- [ ] **Step 5: Commit** `feat(landing): kapsamlı ana sayfa — 17 bölüm + görseller`

---

### Task 6: Fiyatlandırma sayfası + PlanTable + rota

**Files:** Create `frontend/src/marketing/components/PlanTable.tsx`, `frontend/src/pages/marketing/PricingPage.tsx` ; Modify `frontend/src/App.tsx` (import + route) ; Test `frontend/src/pages/marketing/PricingPage.test.tsx`

- [ ] **Step 1: `PlanTable.tsx`** — PLANS'tan 4 sütun; aylık/yıllık toggle (useState); LIMIT_ROWS + FEATURE_ROWS satırları (✅/❌/değer); PRO highlight; her sütunda CTA (`/register` = "7 Gün Ücretsiz", BUSINESS = "Bize Ulaşın" mailto/register).
- [ ] **Step 2: `PricingPage.tsx`** — `<MarketingLayout>` + başlık + `PlanTable` + deneme/grace açıklaması (spec §6) + PLAN SSS (faq alt kümesi). `document.title='Fiyatlandırma — HummyTummy'`.
- [ ] **Step 3: `App.tsx`** — `const PricingPage = lazyWithReload(()=>import('./pages/marketing/PricingPage'))` + `<Route path="/fiyatlandirma" element={<PricingPage/>} />` public grupta (satır ~325 civarı).
- [ ] **Step 4: Test** — `PricingPage.test.tsx`: render; "499", "1.299", "2.999" görünür; 4 plan adı; "7 Gün Ücretsiz". PASS.
- [ ] **Step 5: Commit** `feat(landing): /fiyatlandirma — gerçek plan tablosu + fiyatlar`

---

### Task 7: Entegrasyon doğrulama + görsel QA + lint/build

- [ ] **Step 1:** `npx tsc --noEmit` temiz.
- [ ] **Step 2:** `npm run lint` (yeni dosyalar temiz; gerekirse `npx prettier --write src/marketing src/pages/LandingPage.tsx src/pages/marketing`).
- [ ] **Step 3:** `npm run test:ci` — tüm marketing testleri yeşil.
- [ ] **Step 4:** `npm run build` — başarılı (chunk hataları yok).
- [ ] **Step 5: Görsel QA** — `npm run dev` (arka plan) + Playwright ile `/` ve `/fiyatlandirma`'yı 375/768/1280'de screenshot; yatay scroll yok; görseller yükleniyor; çerçeveler düzgün. Kullanıcıya screenshot göster (görsel onay).
- [ ] **Step 6: Commit** `chore(landing): faz 1 entegrasyon + görsel QA`

---

## Self-Review (spec kapsamı)
- Spec §2 görsel envanteri → Task 1 (opt + images.ts, 20 görsel, 2 yasaklı hariç). ✅
- §3 tasarım sistemi → Task 1 theme + Task 3 primitifler. ✅
- §4 rotalar/dosya yapısı → Task 4 (layout) + Task 6 (route). ✅
- §5 ana sayfa 17 bölüm → Task 5. ✅
- §6 plan matrisi+fiyat → Task 2 (plans.ts) + Task 6 (PricingPage/PlanTable). ✅
- §7 dürüstlük → Global Constraints + her içerik task'ında. ✅
- §2 webp opt → Task 1. ✅
- Placeholder taraması: yok. Tip tutarlılığı: `ImgKey`/`IMG`, `Plan`/`PLANS`, `Module`/`MODULES` tüm tasklarda tutarlı. ✅

## Faz 2 (ayrı plan — Faz 1 ship sonrası)
`ModulePage` (`/ozellikler/:slug`, veri-güdümlü) + `ModulesIndexPage` (`/ozellikler`) + `modules.ts` zengin içerik (hero+3-4 fayda+nasıl-çalışır+SSS+ilgili) + nav mega-menü linklerini spoke'lara repoint. Kendi tag'i.

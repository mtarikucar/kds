# Plan & Erişim + Eklenti + Donanım Satışı Elden Geçirme — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Plana-dahil/zaten-sahip eklentiyi ödeme başlamadan reddet, ölü grant'ları çalışır kıl, plan×özellik drift'ini kapat, Plan & Erişim'i 3-bant (dahil/satın alınabilir/yükselt) kur, donanım satış UX'ini tamamla — tamamı para-güvenli.

**Architecture:** Backend'de kontroller settlement'tan (`purchase()`/`confirmAndProvision`) ön-ödeme aşamasına (`QuoteService.quote` + `CheckoutIntentService.createIntent`) taşınır. Entitlement motoru grant anahtarları düzeltilir + eksik enforcement noktaları eklenir. FE Plan & Erişim ve donanım mağazası mevcut hook'lar üzerine yeniden düzenlenir. Spec: `docs/superpowers/specs/2026-07-22-plan-access-hardware-overhaul-design.md`.

**Tech Stack:** NestJS + Prisma (backend, jest), Vite+React+TS (frontend, vitest), i18next 5 locale (ar/en/ru/tr/uz), PayTR + havale ödeme rayları, entitlement engine (feature./limit./integration. grants).

## Global Constraints

- **Commit/PR:** düz conventional, HİÇBİR Claude/AI izi yok (Co-Authored-By: Claude / Generated with YASAK). Author `tarik <56091479+mtarikucar@users.noreply.github.com>`.
- **Migration & seed REVERSIBLE:** her şema/seed değişimi up/down çift; down idempotent, tam-scoped, operatör verisine dokunmaz; up mümkünse idempotent; round-trip (up→down→up) doğrulanır.
- **i18n:** her yeni/değişen anahtar AYNI commit'te 5 locale'e (ar/en/ru/tr/uz); referans `en`; parite + value-drift kapıları exit 0.
- **Para yolları TDD:** her tahsilat-kapısı fix'ine exploit-önleyici test (curl/tamper senaryosu birebir) ÖNCE yazılır, kırmızı görülür.
- **Hide-not-403 + dürüst upsell** desenleri korunur.
- **Branch:** tüm işler `feat/plan-access-overhaul` (worktree `~/Projects/kds-plan`, merged main tabanı). Görev-başına commit. Push `scripts/push-via-openssl.sh` + PR `gh`.
- **Doğrulama:** backend `cd backend && npx tsc --noEmit && npm run lint:ci && npm test`; gerçek-DB e2e gate PR'da koşar. frontend `cd frontend && npx tsc --noEmit && npm run test:ci`. i18n `node scripts/check-i18n-parity.mjs` repo kökünden.
- **Kaynak alıntılar:** her görev, ilgili mevcut kodu okumak için gerçek dosyaları açar (satır numaraları taban ilerlediği için yaklaşık — SEMBOL'le bul).

---

## FAZ 1 — Tahsilat kapıları (P0)

### Task 1: Eklenti tahsilat-önü guard servisi + quote/intent entegrasyonu

**Defect:** `QuoteService.quote` eklenti satırında yalnız `status==="published"` kontrol eder (`backend/src/modules/checkout/quote.service.ts`, `addon` dalı); `CheckoutIntentService.createIntent` entitlement/sahiplik/deps bakmaz. `isIncludedInEntitlements`, aktif-TenantAddOn dup guard'ı ve deps kontrolü yalnız `TenantMarketplaceService.purchase()` içinde — o da PayTR settle olduktan SONRA (`confirmAndProvision`). Sonuç: plana-dahil / zaten-sahip / deps-eksik eklentiye tam fiyat ödenir, grant reddedilir, iade yok (DEF-1/2/4).

**Files:**
- Create: `backend/src/modules/checkout/addon-purchasability.service.ts`
- Modify: `backend/src/modules/checkout/quote.service.ts` (addon dalı), `checkout-intent.service.ts` (createIntent başı)
- Modify: `backend/src/modules/checkout/checkout.module.ts` (yeni servis provider + EntitlementModule/MarketplaceModule import)
- Test: `backend/src/modules/checkout/addon-purchasability.service.spec.ts`, `.../checkout-intent.addon-guard.spec.ts`

**Interfaces:**
- Consumes: `EntitlementService.getForTenant(tenantId)`, `TenantMarketplaceService.isIncludedInEntitlements(grants, ent)` (static), `AddOnCatalogService.findByCodeOrThrow`, `prisma.tenantAddOn`.
- Produces: `AddonPurchasabilityService.assertPurchasable(tenantId, { addOnCode, branchId, quantity }): Promise<void>` — throws `ConflictException` with a machine code (`ADDON_INCLUDED_IN_PLAN` | `ADDON_ALREADY_OWNED` | `ADDON_REQUIRES_PLAN` | `ADDON_LIMIT_REDUNDANT`). Task 2 (aynı-plan yenileme) ve Task 8 (FE hata gösterimi) bu kodları kullanır.

- [ ] **Step 1: Exploit testleri yaz (RED)** — dört senaryo, her biri intent AÇILAMAZ:
  1. PRO tenant (advancedReports dahil) `advanced_reports` eklentisini sepete koyar → `createIntent` `ConflictException` code `ADDON_INCLUDED_IN_PLAN`, `prisma.checkoutIntent.create` HİÇ çağrılmaz (spy).
  2. Aktif `advanced_reports` TenantAddOn'u olan tenant aynısını alır → `ADDON_ALREADY_OWNED`.
  3. BASIC tenant `fiscal_hugin` (deps `plan:PRO`) alır → `ADDON_REQUIRES_PLAN`. BUSINESS tenant AYNI eklentiyi alır → GEÇER (deps "PRO ve üstü" semantiği).
  4. BUSINESS tenant (maxBranches=-1) `extra_branch` alır → `ADDON_LIMIT_REDUNDANT` (ilgili efektif limit -1).
  Test kurulum deseni için mevcut checkout spec'lerini (grep `checkout-intent` `.spec.`) örnek al; entitlement/prisma mock'ları oradaki gibi.

- [ ] **Step 2: RED doğrula** — `npm test -- addon-purchasability` → FAIL (servis yok).

- [ ] **Step 3: AddonPurchasabilityService'i yaz.** `assertPurchasable`:
  - addon = `findByCodeOrThrow`; grants oku.
  - `isIncludedInEntitlements(grants, ent)` true → throw `ADDON_INCLUDED_IN_PLAN`.
  - aktif `tenantAddOn.findFirst({ tenantId, addOnId, branchId: branchId ?? null, status:'active' })` → throw `ADDON_ALREADY_OWNED`.
  - deps: `purchase()` içindeki deps mantığını (plan:X + addon-dep) BURAYA taşı, ama `plan:X` semantiğini **"X ve üstü"** yap: plan sıralaması (FREE<BASIC<PRO<BUSINESS — mevcut plan sıralama kaynağını bul, `subscription.service` plan tier'ı) ile `tenantTier >= depTier`. Eksikse throw `ADDON_REQUIRES_PLAN`.
  - `limit.*` grant'ı taşıyan eklenti için ilgili efektif limit (ent.limits[key]) -1 ise throw `ADDON_LIMIT_REDUNDANT` (DEF-8). Anahtar eşlemesi: grant `limit.maxBranches` → ent `limit.maxBranches` (Task 5'ten SONRA anahtar uyumlu olacak; Task 5 bu görevden önce gelmez ise `limit.branches`→`maxBranches` map'i geçici tut ve yorumla).
  - Exception tipi: `ConflictException`; body `{ code, message, addOnCode }`. (Not: `purchase()` içindeki mevcut deps/dup guard'ları defence-in-depth olarak KALIR — silme.)

- [ ] **Step 4: quote + intent entegrasyonu.** `CheckoutIntentService.createIntent` başında (quote'tan önce veya sonra), cart'taki her `addon` satırı için `assertPurchasable(tenantId, {...})` çağır — HERHANGİ biri atarsa intent açılmaz (checkoutIntent.create'ten önce). `QuoteService.quote`'a dokunma (quote saf fiyatlama kalsın; kapı intent'te — ama quote'u da guard'lamak istersen warning ekle, tahsilat kapısı intent'te yeterli). `tenantId` createIntent arg'ında zaten var.

- [ ] **Step 5: GREEN + modül wiring.** `checkout.module.ts`'e servis + gerekli import'lar. `npm test -- addon-purchasability checkout-intent` → PASS; `npx tsc --noEmit` 0.

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "fix(checkout): reject included/owned/deps-missing add-ons before payment"
```

---

### Task 2: Aynı-plan tam-fiyat yenileme reddi (abonelik + havale)

**Defect:** `payments.service.ts` `isUpgrade = planId !== plan.id`; ACTIVE tenant aynı planı seçerse tam-tutarlı PENDING oluşur, settlement `currentPeriodStart: now` yazar → dönem uzamaz, SIFIRLANIR (kalan günler yanar). Havale rayı aynı (DEF-5). Koruma yalnız istemcide.

**Files:**
- Modify: `backend/src/modules/subscriptions/payments.service.ts` (createIntent), `bank-transfer.service.ts` (createIntent)
- Test: `.../payments.same-plan-guard.spec.ts`, `.../bank-transfer.same-plan-guard.spec.ts`

- [ ] **Step 1: RED** — ACTIVE + aynı planId intent isteği `ConflictException` code `SAME_PLAN_ACTIVE`; PAST_DUE + aynı plan (yenileme) GEÇER (istisna). Her iki rayda.
- [ ] **Step 2:** `npm test -- same-plan-guard` → FAIL.
- [ ] **Step 3:** İki `createIntent`'te: subscription status ACTIVE **ve** hedef planId == mevcut plan.id ise reddet — istisna: status PAST_DUE (yenileme meşru). Mevcut status okuma noktasını bul (createIntent zaten subscription çeker).
- [ ] **Step 4:** GREEN + tsc 0.
- [ ] **Step 5:** `git commit -m "fix(subscriptions): reject full-price renew of the active plan (both payment rails)"`

---

### Task 3: Settlement deterministik-dup kalıcı-fail + alarm

**Defect:** Provisioning başarısızlığı (deterministik dup vb.) sonrası `checkout-settlement.service.ts` status'u `succeeded`'a geri sarar ("for retry") — deterministik hata retry'da da başarısız → intent sonsuza dek "succeeded" asılı, para alınmış, hiçbir şey verilmemiş (DEF-2 kuyruğu).

**Files:**
- Modify: `backend/src/modules/checkout/checkout-settlement.service.ts` (catch bloğu ~71-129)
- Test: `.../checkout-settlement.permanent-fail.spec.ts`

- [ ] **Step 1: RED** — `confirmAndProvision` deterministik hata (dup `BadRequestException`) fırlatınca intent `failed_permanent`'a geçer (retry'lanabilir hatadan — P2034 serialization — AYIRT edilerek: o hâlâ `succeeded`); bir alarm-log/kayıt üretilir.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** catch'te hata sınıfını ayırt et: `BadRequestException`/`ConflictException` gibi deterministik (4xx-eşdeğeri) → `status: 'failed_permanent'` + `this.logger.error('SETTLEMENT_PERMANENT_FAIL ...')` (superadmin alarm listesi bu logdan/durumdan beslenir). Serialization/transient → mevcut `succeeded` (retry) davranışı korunur. Status-scoped updateMany deseni korunur (concurrent winner clobber'lanmaz). Otomatik iade YOK — kapsam dışı, yalnız durum+alarm.
- [ ] **Step 4:** GREEN. (Not: `failed_permanent` yeni bir CheckoutIntent status değeri — şema `status` String ise migration gerekmez; enum ise reversible migration ekle.)
- [ ] **Step 5:** `git commit -m "fix(checkout): mark deterministic provisioning failures failed_permanent, not retry"`

---

### Task 4: Donanım stok kontrolü ödeme-önüne + stockStatus türetilmiş

**Defect:** Seed `hardwareInventory` `available=0` (`seed-marketplace.ts:1172-1179`), her ürün elle `stockStatus:"in_stock"`; quote/intent stok bakmaz; `allocate()` `confirmAndProvision` içinde (PayTR SONRASI) → her DIRECT_SALE alım "ödedi, stok yok"a düşebilir (Donanım #1).

**Files:**
- Modify: `backend/src/modules/checkout/quote.service.ts` (hardware dalı), `checkout-intent.service.ts` (createIntent), `backend/src/modules/marketplace/catalog.service.ts` (stok okuma helper)
- Modify: `backend/prisma/seeds/seed-marketplace.ts` (reversible: temsili stok değerleri) + gerekiyorsa data migration
- Test: `.../checkout-intent.hardware-stock.spec.ts`

- [ ] **Step 1: RED** — `available - reserved < qty` olan SKU sepette → `createIntent` `ConflictException` code `HARDWARE_OUT_OF_STOCK`, intent açılmaz. Yeterli stokta → geçer.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:**
  - `CatalogService`'e `getAvailableStock(productId): Promise<number>` (`hardwareInventory.available - reserved`) helper.
  - `createIntent`'te her `hardware` satırı için `available >= qty` değilse reddet (allocate'ten önce). quote'a `warnings.push({code:'hardware_out_of_stock'})` da ekle (görüntü için).
  - `stockStatus` elle alanını envanterden TÜRET: ürün listeleme/detay yanıtında `stockStatus` artık `available>0 ? 'in_stock':'out_of_stock'` (elle alan okunmaz; kaldır ya da compute et). Şema alanını silmek migration ister — SİLME, sadece OKUMA'yı compute'a çevir (daha az riskli); yorumla.
  - Seed: temsili stok (`available: 25` gibi) — reversible (down `available: 0`'a döner, yani mevcut davranış).
- [ ] **Step 4:** GREEN + tsc 0. Migration round-trip (varsa) doğrula.
- [ ] **Step 5:** `git commit -m "fix(hardware): check stock before payment, derive stockStatus from inventory"`

---

## FAZ 2 — Grant / enforcement / drift

### Task 5: extra_branch grant anahtarı düzeltmesi (reversible migration + seed)

**Defect:** Seed `extra_branch` grant `{ "limit.branches": 1, "feature.multiLocation": true }`; guard `limit.maxBranches` okur (LIMIT_COLUMNS + `check-limit.decorator`) → ödeme var, şube limiti artmaz (DEF-6). Ölü grant.

**Files:**
- Modify: `backend/prisma/seeds/seed-marketplace.ts` (`extra_branch.grants`)
- Create: `backend/prisma/migrations/<ts>_fix_extra_branch_grant/migration.sql` (+ down) — mevcut `MarketplaceAddOn` satırının grants JSON'unu `limit.branches`→`limit.maxBranches` çevirir; ayrıca yayınlanmış TenantAddOn projeksiyonlarını yeniden tetiklemek için not.
- Test: `.../extra-branch-grant.spec.ts` (e2e: extra_branch alımı sonrası efektif maxBranches +1)

- [ ] **Step 1: RED** — extra_branch grant'lı tenant'ın entitlement motorunda `limit.maxBranches` planı +1; guard limiti artmış görür. (Bugün `limit.branches` yazıldığı için FAIL.)
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Seed grant'ını `{ "limit.maxBranches": 1, "feature.multiLocation": true }` yap. Reversible data migration: `UPDATE "MarketplaceAddOn" SET grants = jsonb_set(grants - 'limit.branches', '{limit.maxBranches}', '1') WHERE code='extra_branch'` (down tersi). Migration idempotent (`WHERE grants ? 'limit.branches'`). Not: mevcut aktif TenantAddOn'lar için projeksiyon yeniden çalışmalı — plan-projector'ın addon projeksiyonu bir sonraki entitlement invalidate'te düzelir; migration sonrası etkilenen tenant'lar için `invalidate` notu ekle.
- [ ] **Step 4:** GREEN; migration up→down→up round-trip doğrula (throwaway Postgres veya e2e gate).
- [ ] **Step 5:** `git commit -m "fix(entitlements): extra_branch grants limit.maxBranches so the cap actually rises"`

---

### Task 6: KDS ekran/istasyon + tablet limit enforcement

**Defect:** `limit.kdsScreens/kdsStations/tablets` grant'ları motora yazılıyor ama hiçbir enforcement noktası okumuyor (DEF-7). Ücretli eklentiler davranış değiştirmiyor. **Karar: gerçek enforcement yazılacak.**

**Files:**
- Modify: `backend/src/modules/subscriptions/decorators/check-limit.decorator.ts` (LimitType'a KDS_SCREENS/KDS_STATIONS/TABLETS)
- Modify: KDS ekran/istasyon kayıt uçları + tablet/cihaz kayıt ucu (grep ile bul: device-mesh slot create, kds screen create, waiter tablet register) — `@CheckLimit` uygula ya da servis-içi sayım
- Modify: `plan-feature.guard.ts` `checkLimit` sayım switch'i (yeni limit tipleri için mevcut kayıt sayısını okuyacak sorgu)
- Test: `.../kds-tablet-limit.spec.ts`

- [ ] **Step 1: Keşif** — bu limitlerin kayıt noktalarını bul: `grep -rn "kdsScreen\|kdsStation\|kds.*slot\|waiter.*tablet\|deviceSlot" backend/src`. `plan-feature.guard.checkLimit` sayımı nasıl yapıyor (mevcut maxTables/maxUsers sayım sorgusu) oku. NOT: doğru sayım kaynağı bulunamazsa BLOCKED raporla (enforcement noktası yoksa eklemek mimari karar).
- [ ] **Step 2: RED** — limiti dolu tenant yeni KDS ekranı/istasyon/tablet kaydı → 403 `LIMIT_REACHED`; eklenti alımı sonrası limit +1 → kayıt geçer.
- [ ] **Step 3:** LimitType enum + guard sayım switch'ine üç tip; kayıt uçlarına `@CheckLimit`. Sayım sorgusu ilgili tablodan (KDS screen kayıtları, tablet cihazları) tenant-scoped count. Efektif limit motordan (`engineSet.limits['limit.maxKdsScreens']` — DİKKAT: grant anahtarı `limit.kdsScreens`, LimitType değeri anahtar sonekiyle eşleşmeli; guard `limit.${limitType}` kuruyor → LimitType değeri `kdsScreens` olmalı, `maxKdsScreens` değil; mevcut grant anahtarıyla hizala).
- [ ] **Step 4:** GREEN + tsc 0. (Enforcement noktası gerçekten yoksa Step 1'de BLOCKED.)
- [ ] **Step 5:** `git commit -m "feat(entitlements): enforce KDS screen/station + tablet capacity limits"`

---

### Task 7: Entegrasyon eklentileri — kapıları aç + kapsama eşlemesi

**Defect:** delivery kapıları `feature.deliveryIntegration` okur; eklenti `integration.delivery` grant'ı verir → BASIC'e satılan eklenti kilidi açmaz; delivery'si plana dahil tenant'a eklenti "satın alınabilir" görünür (DEF-3). fiscal/caller aynı sınıf. **Karar: satış kalır, kapılar `integration.delivery`'yi DE kabul eder + isIncludedInEntitlements plan-feature↔integration eşlemesi.**

**Files:**
- Create/Modify: `backend/src/modules/entitlements/integration-coverage.ts` (tek kaynak `INTEGRATION_COVERED_BY_FEATURE = { delivery: 'deliveryIntegration' }` — fiscal/caller plan-feature'a bağlı değil, boş)
- Modify: `tenant-marketplace.service.ts` `isIncludedInEntitlements` (integration grant'ı, kapsayan plan-feature true ise dahil say)
- Modify: delivery controller'ları — `@RequiresIntegration('delivery')` kullan VEYA guard'ın integration-check'ini `feature.deliveryIntegration`'ı da kabul edecek şekilde genişlet (guard'ın mevcut integration çözümünü OKU önce; `requires-integration.decorator` doc'u "cross-checks feature.deliveryIntegration" diyor — guard bunu gerçekten yapıyor mu DOĞRULA, yapmıyorsa ekle)
- Test: `.../integration-coverage.spec.ts`, `.../delivery-gate.spec.ts`

- [ ] **Step 1: Keşif + RED** — guard'ın `@RequiresIntegration` çözümünü oku (`plan-feature.guard` integration branch). İki test: (a) delivery'si plana dahil (feature.deliveryIntegration=true, integration.delivery YOK) tenant için delivery eklentisi `isIncludedInEntitlements`=true (bugün false → FAIL); (b) yalnız `integration.delivery=[yemeksepeti]` grant'lı (feature yok) BASIC tenant delivery kapısından GEÇER (bugün feature okunduğu için FAIL).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:**
  - `isIncludedInEntitlements`: `integration.<domain>` grant'ı işlenirken, `INTEGRATION_COVERED_BY_FEATURE[domain]` bir plan-feature'a işaret ediyor ve `ent.features['feature.'+that]===true` ise bu grant KAPSANMIŞ say (vendor listesine bakmadan). Aksi hâlde mevcut vendor-liste kontrolü.
  - Delivery kapıları: guard integration branch'i `integration.delivery` grant'ı VEYA `feature.deliveryIntegration` görürse geçirsin (çift kabul). En temizi: delivery controller'larını `@RequiresIntegration('delivery')`'ye çevir + guard'ın integration-check'ine "kapsayan feature true ise geç" kuralı ekle (tek yerde, `INTEGRATION_COVERED_BY_FEATURE` ile). Böylece plan-delivery tenant da eklenti-delivery tenant da açılır.
- [ ] **Step 4:** GREEN + tsc 0 + tam backend test (delivery/fiscal mevcut testleri kırılmasın).
- [ ] **Step 5:** `git commit -m "fix(entitlements): plan feature covers integration add-ons; open delivery gates to integration grants"`

---

### Task 8: Mapper drift düzeltmesi + tripwire test

**Defect:** `getAvailablePlans` features'ta `posAccess` eksik, limits'te `maxBranches` eksik → satış sayfası POS tüm planlarda ✗, şube hücresi "NaN" (DRIFT-1). `aiContentGeneration` 3 provisioning/demo aynasında eksik (DRIFT-2/3/4); DEMO AI limitleri 0.

**Files:**
- Modify: `backend/src/modules/subscriptions/subscription.service.ts` (getAvailablePlans), `tenant-provisioning.service.ts`, `auth-provisioning.service.ts`, `demo.service.ts`
- Modify/Create: mapper tripwire test (şema plan kolonları = FEATURE_COLUMNS = getAvailablePlans anahtarları)
- Modify: `frontend/src/.../PlanComparisonMatrix.tsx` (NaN → "—" defensive; ama asıl fix backend)
- Test: `.../plan-mapper-parity.spec.ts` + FE PlanComparisonMatrix testi

- [ ] **Step 1: RED** — tripwire: FEATURE_COLUMNS (13) her anahtarı `getAvailablePlans` features bloğunda görünmeli; LIMIT_COLUMNS (9) limits bloğunda. Bugün posAccess+maxBranches eksik → FAIL. Ayrıca provisioning/demo ALL_FEATURES setlerinde `aiContentGeneration` bekle.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** `getAvailablePlans`'a `posAccess` (features) + `maxBranches` (limits); 3 aynaya `aiContentGeneration`; DEMO planına keşfedilebilir AI limitleri. FE `PlanComparisonMatrix`'te `Number(undefined)`→NaN'ı `?? '—'` ile savun.
- [ ] **Step 4:** GREEN; FE testi POS satırının doğru plan hücrelerinde ✓, şube hücresinde sayı gösterdiğini doğrular.
- [ ] **Step 5:** `git commit -m "fix(subscriptions): close plan-mapper drift (posAccess, maxBranches, aiContentGeneration) + tripwire"`

---

## FAZ 3 — Plan & Erişim 3-bant redesign

### Task 9: Dahil bandı + fail-closed satın alınabilir + i18n

**Defect:** `PlanAndAccessPage.tsx` boolean plan özelliklerini HİÇ listelemez; dahil eklentileri önerilerden gizler ama "dahil" göstermez; filtre `!c.includedInPlan` fail-open (undefined→önerilir, DEF-9); catalog mutasyonlarda invalidate edilmez (DEF-10); sabit-kodlu "Sınırsız"/"/ay"/"Üst pakete geç" + öz-link (`/admin/plan`).

**Files:**
- Modify: `frontend/src/features/plan/PlanAndAccessPage.tsx`, `frontend/src/features/marketplace/marketplaceApi.ts` (invalidation)
- Modify: `frontend/src/i18n/locales/{ar,en,ru,tr,uz}/plan.json`
- Test: `frontend/src/features/plan/PlanAndAccessPage.test.tsx` (genişlet)

- [ ] **Step 1: RED** — (a) plana-dahil eklenti "Planınıza dahil" rozetiyle GÖRÜNÜR, satın alınabilir listesinde YOK; (b) `includedInPlan===undefined` eklenti satın alınabilir listesinde GÖRÜNMEZ (fail-closed: yalnız `includedInPlan===false` satılabilir); (c) plan özellik listesi 13 bayraktan dahil olanları gösterir (SubscriptionContext hasFeature). MarketplacePage rozet desenini (`MarketplacePage.tsx` "Planınıza dahil" bloğu) örnek al.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:**
  - Üç bant: **Dahil** (plan özellik listesi + `catalog.filter(c => c.includedInPlan===true)` rozetli) / **Satın alınabilir** (`catalog.filter(c => c.includedInPlan===false && !ownedCodes.has(c.code))` — fail-closed) / **Aktif eklentiler** (mevcut).
  - `marketplaceApi`: plan-değişim/purchase/cancel mutasyonlarında `marketplaceKeys.catalog` invalidation.
  - Sabit dizgeler i18n'e (5 dil); kota kartı "Üst pakete geç →" öz-linki `/subscription/change-plan`'a.
- [ ] **Step 4:** GREEN + parite 0 + tsc 0.
- [ ] **Step 5:** `git commit -m "feat(plan): three-band Plan & Access (included / purchasable / upgrade), fail-closed"`

---

## FAZ 4 — Donanım satış UX

### Task 10: Ödeme dönüş sonuç ekranı + sepet adet + quote-önce-ödeme kilidi

**Files:**
- Modify: `frontend/src/features/hardware-store/StorePage.tsx` (checkout button disabled until quote; cart qty UI via `cartStore.setQty`), return-result handling on `/admin/store`
- Create: donanım sonuç bileşeni (subscription `PaymentResultPage` desenini örnek al)
- Modify: `frontend/src/i18n/locales/{5}/hardware.json` (EN toast'lar `storeApi.ts:229-231` + yeni dizgeler)
- Test: `frontend/src/features/hardware-store/*.test.tsx`

- [ ] **Step 1: RED** — (a) quote alınmadan "Ödemeye geç" disabled; (b) sepet satırında adet ± UI `setQty` çağırır; (c) `/admin/store?intent=<ref>` dönüşünde başarı/bekliyor/başarısız durumu gösterilir.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Uygula; EN hardcoded toast'ları (`'Order placed.'`, `'Checkout failed'`) i18n'e; sonuç ekranı intent durumunu poll eder (abonelik deseni).
- [ ] **Step 4:** GREEN + parite 0.
- [ ] **Step 5:** `git commit -m "feat(hardware): payment result screen, cart quantity UI, quote-before-pay lock"`

---

### Task 11: Kira kaldırma + KDV metni + placeholder temizliği + kategori fix

**Files:**
- Modify: `backend/prisma/seeds/seed-marketplace.ts` (rentalMonthlyCents kaldırma / rent purchaseOption; Ingenico → `pos_terminal` kategori) — reversible migration
- Modify: `frontend/src/features/hardware-store/*` (rent UI kaldır; KDV metni "KDV dahil"; sahte destek hattı/compliance placeholder render'dan çıkar)
- Modify: `backend/src/modules/checkout/quote.service.ts` (kargo satırı "sabit ücret" şeffaf — string/meta)
- Test: donanım quote/katalog testleri güncellenir

- [ ] **Step 1: RED** — (a) katalog/detay rent seçeneği SUNMAZ; (b) hizmet detay metni KDV-dahil ile tutarlı; (c) Ingenico ürünleri `pos_terminal` kategorisinde (yazarkasa değil). Reversible migration (down eski değerlere döner).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Uygula; rent'i UI+quote'tan kaldır (quote'un `acquisition==='rent'` dalı kalabilir ama katalog rent sunmaz — ölü değil, ileride geri gelecek; yorumla). Placeholder'lar: sahte "0850 000 00 00" ve compliance dokümanlarını render'dan çıkar ya da gerçek değerle değiştir (kullanıcıya sor gerekmez — placeholder kaldır).
- [ ] **Step 4:** GREEN; migration round-trip; parite 0.
- [ ] **Step 5:** `git commit -m "feat(hardware): remove rent for now, fix VAT copy, drop placeholders, recategorize bank POS"`

---

### Task 12: Uçtan uca doğrulama + PR

- [ ] **Step 1: Tüm kapılar** (worktree'den):
```bash
cd backend && npx tsc --noEmit && npm run lint:ci && npm test
cd ../frontend && npx tsc --noEmit && npm run test:ci && npm run build
cd .. && node scripts/check-i18n-parity.mjs && node scripts/check-i18n-value-drift.mjs --gate-new scripts/i18n-value-drift-baseline.json
```
Hepsi yeşil. Migration round-trip'leri (Task 4/5/11) throwaway Postgres'te up→down→up doğrula.
- [ ] **Step 2: Exploit-özeti manuel doğrulama** — dört para-kapısı (dahil/sahip/deps/stok) için intent'in açılmadığını e2e ya da curl ile teyit.
- [ ] **Step 3: Push + PR**
```bash
bash /home/tarik/Projects/kds/scripts/push-via-openssl.sh feat/plan-access-overhaul
gh pr create --repo mtarikucar/kds --base main --head feat/plan-access-overhaul --title "..." --body-file <özet>
```
PR gövdesinde AI izi YOK.

---

## Self-Review Notları

- **Spec kapsaması:** F1 DEF-1/2/4→T1, DEF-5→T2, DEF-2-kuyruk→T3, Donanım#1→T4; F2 DEF-6→T5, DEF-7→T6, DEF-3→T7, DRIFT-1..4→T8; F3→T9; F4 sonuç/sepet→T10, rent/KDV/placeholder/kategori→T11; doğrulama→T12.
- **Bilinen riskler:** (1) T6 enforcement noktası gerçekten yoksa BLOCKED — mimari genişleme kullanıcı onayı ister. (2) T5/T4/T11 migration'ları REVERSIBLE olmalı (global kural) — round-trip T12'de. (3) T7 guard'ın integration-check'i doc'un iddia ettiğini yapmıyor olabilir — Step 1 keşfi doğrular. (4) `failed_permanent` yeni status değeri — şema String değilse migration. (5) plan tier sıralaması (T1 deps "X ve üstü") için kaynak `subscription.service`'ten okunmalı, uydurma sıra değil.
- **Para yolları:** her F1 görevi exploit-testiyle açılır; `purchase()` içindeki mevcut guard'lar defence-in-depth kalır (silme).

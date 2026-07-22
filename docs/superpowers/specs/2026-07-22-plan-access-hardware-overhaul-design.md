# Plan & Erişim + Eklenti + Donanım Satışı Elden Geçirme — Tasarım

**Tarih:** 2026-07-22 · **Branch:** `feat/plan-access-overhaul` (merged main `d98d0700` tabanı, worktree `~/Projects/kds-plan`) · **Kapsam:** FE + BE (tahsilat kapıları + enforcement + data migration'lar) — bu program backend'e DOKUNUR.

## 1. Problem (6-ajanlı denetim, sentez 2026-07-22)

Sahibin şikâyeti doğrulandı + para bütünlüğü bulguları:
- `includedInPlan` yalnız FE koruması; quote/checkout-intent plana-dahil eklentiyi tahsil edip provision ediyor (DEF-1). Zaten-sahip-olunan eklentide para alınıp grant reddediliyor, iade yok (DEF-2).
- `delivery_*` eklentileri `integration.delivery` grant'ı veriyor ama tüm kapılar `feature.deliveryIntegration` okuyor → BASIC'e satılan eklenti hiçbir şey açmıyor; plan projektörü `integration.*` üretmediği için delivery'si plana dahil tenant'lara satın alınabilir görünüyor (DEF-3). `fiscal_hugin` deps `plan:PRO` katı eşitlik + kontrol ödeme sonrası (DEF-4).
- Aynı plana tam-fiyat "yenileme" dönemi sıfırlıyor (DEF-5).
- `extra_branch` grant anahtarı `limit.branches` ≠ guard'ın okuduğu `limit.maxBranches` → ödeme var, limit artmıyor (DEF-6); `kds_extra_screen/station/tablet` limitlerinin tüketicisi yok (DEF-7); sınırsız-limitli planlara ölü kapasite eklentisi öneriliyor (DEF-8).
- Mapper drift'i: `getAvailablePlans`'ta `posAccess`+`maxBranches` eksik → satış sayfasında POS tüm planlarda ✗, şube hücresi "NaN" (DRIFT-1); `aiContentGeneration` 3 provisioning/demo aynasında eksik (DRIFT-2/3/4).
- Donanım: stok tahsisi ödemeden SONRA + seed stok 0 + elle "in_stock" → her DIRECT_SALE "ödedi, sipariş düşmedi"ye düşebilir; rent'in aylık tahsilat rayı yok; toplam görmeden ödeme; dönüş ekranı yok; KDV metni yanlış; sepet adet UI yok; sahte destek hattı/compliance; EN hardcoded toast; Ingenico yanlış kategori.

Ayrıntı: sentez raporu (oturum artefaktı) + kod referansları buradaki fazlarda.

## 2. Onaylanan kararlar (2026-07-22)

1. **KDS/tablet kapasite eklentileri:** katalogdan çekilmek yerine **gerçek enforcement yazılacak** (`limit.kdsScreens`, `limit.kdsStations`, `limit.tablets` kayıt noktalarında sayım + `CheckLimit` deseni).
2. **Entegrasyon eklentileri:** satış KALIR; kapılar `integration.delivery` grant'ını da kabul eder; `isIncludedInEntitlements`'a plan-feature↔integration kapsama eşlemesi eklenir (fiscal/caller aynı desene).
3. **Donanım kira (rent):** şimdilik kaldırılır (yalnız satın-al); recurring kira ayrı proje.
4. **Faz sırası onaylı:** F1 para kapıları + stok-önce-ödeme → F2 grant/enforcement/drift → F3 Plan & Erişim 3-bant → F4 donanım UX.

## 3. Hedef davranış

### F1 — Tahsilat kapıları (P0, backend)
- `QuoteService.quote` + `CheckoutIntentService.createIntent` eklenti satırında ödeme BAŞLAMADAN reddeder: (a) `isIncludedInEntitlements` true → `ADDON_INCLUDED_IN_PLAN`; (b) aktif `TenantAddOn` (tenant, addOn, branch) → `ADDON_ALREADY_OWNED`; (c) deps doğrulaması (plan:X = "X ve üstü" semantiği) → `ADDON_REQUIRES_PLAN`. FE bu hataları kullanıcı diliyle gösterir.
- Settlement'ta deterministik dup-fail için: intent `failed_permanent` durumu + superadmin alarm listesi (otomatik iade YOK — manuel süreç, ama asılı "succeeded" kalmaz).
- Abonelik: ACTIVE + aynı-plan intent'i reddedilir (PAST_DUE "Şimdi yenile" istisna) — `payments.service` + `bank-transfer.service` ikisi de.
- Donanım: stok kontrolü quote + intent aşamasına iner (`available - reserved >= qty`); `stockStatus` elle alan olmaktan çıkıp envanterden türetilir; yetersiz stokta ödeme başlamaz.

### F2 — Grant/enforcement/drift
- `extra_branch` grant anahtarı `limit.maxBranches`'e migre edilir (reversible data migration: mevcut satırlar + seed; down eski anahtara döner).
- KDS/tablet enforcement: kayıt uçlarında (device-mesh slot/KDS ekran-istasyon/tablet kayıt) efektif limit okunur (`plan limiti + eklenti grant'ları`, -1 sınırsız); aşımda 403 `LIMIT_REACHED` + UpsellCard akışı. Sayım kaynağı mevcut cihaz kayıtları.
- Entegrasyon kapsama eşlemesi: `INTEGRATION_COVERED_BY_FEATURE: { delivery: 'deliveryIntegration', fiscal: null, caller: null }` tek kaynak; `isIncludedInEntitlements` + `RequiresIntegration`/gate'ler bu eşlemeyle plan-özelliğini kabul eder (delivery kapıları `integration.delivery` grant'ını DA kabul eder — çift yön).
- DRIFT-1..4 düzeltilir (`getAvailablePlans` posAccess+maxBranches; 3 aynada `aiContentGeneration`; DEMO AI limitleri keşfedilebilir değer alır). Mapper'lara şema-anahtar sayısı tripwire testi eklenir (13 bayrak + 9 limit eksiksiz).
- DEF-8: `limit.*` eklentisi, ilgili efektif limit -1 ise `includedInPlan=true` benzeri "gereksiz" işaretiyle listeden düşer (satın alma kapısı da reddeder).

### F3 — Plan & Erişim 3-bant
- **Dahil bandı:** plan özellik listesi (13 bayrak, `getEffectiveFeatures`) + plana-dahil eklentiler "Planınıza dahil" rozetiyle GÖSTERİLİR (gizlenmez; MarketplacePage rozet deseni taşınır).
- **Satın alınabilir bandı:** fail-closed filtre (`includedInPlan !== false` değil `=== false` mantığı ters çevrilir: yalnız açıkça satılabilir olan gösterilir); mutasyonlarda catalog invalidation; sınırsız-plan ölü önerileri yok.
- **Yükselt bandı:** kota kartı öz-linki `/subscription/change-plan`'a; "Sınırsız"/"/ay"/"Üst pakete geç" i18n (5 dil).
- prorationAmount/tahsilat tutarsızlığı: gösterim tahsil edilecek tutara eşitlenir.

### F4 — Donanım satış UX
- Ödeme dönüş sonuç ekranı (`/admin/store` return'de intent durumu: başarılı/bekliyor/başarısız — abonelikteki PaymentResultPage deseni).
- Sepet: adet düzenleme UI (`setQty` bağlanır); "Ödemeye geç" quote alınmadan disabled; quote sonrası satır+toplam görünür.
- Rent seçeneği UI+katalogdan kaldırılır (reversible migration ile purchaseOptions'tan `rent` düşer; down geri ekler).
- KDV metni gerçekle eşitlenir ("KDV dahil"); EN toast'lar i18n'e (5 dil); sahte destek hattı/compliance placeholder'ları gerçek değerlerle değiştirilir ya da render'dan kaldırılır; Ingenico ürünleri `pos_terminal` kategorisine migre (reversible); kargo satırı "sabit ücret" olarak ŞEFFAF etiketlenir (gerçek kargo entegrasyonu kapsam dışı).

## 4. Kurallar / kısıtlar

- Migration + seed değişiklikleri REVERSIBLE up/down, idempotent (global kural).
- Commit/PR'larda AI izi YOK. i18n 5-dil parite aynı commit'te. Hide-not-403 + dürüst upsell desenleri korunur.
- Para yollarında TDD zorunlu; her tahsilat-kapısı fix'ine exploit-önleyici test (curl senaryosu birebir).
- Backend testleri gerçek-DB e2e gate'inden geçer; `lint:ci` merge sonrası kontrol.
- Tek branch, faz-başına-commit(ler); worktree `kds-plan`; push openssl script + `gh`.

## 5. Kapsam dışı

Recurring donanım kirası; gerçek kargo entegrasyonu; delivery eklenti fiyat stratejisi değişikliği; superadmin iade otomasyonu (yalnız alarm listesi girer); Paygo cert-gated işler.

## 6. Başarı ölçütleri

- Exploit testleri: dahil/sahip-olunan/deps-eksik eklentiye ve stok-yetersiz donanıma intent AÇILAMAZ (402/409 sınıfı hata, ödeme başlamaz).
- `extra_branch` alımı şube limitini gerçekten artırır (e2e); KDS/tablet limitleri kayıtta uygulanır.
- Satış sayfası: POS satırı doğru, NaN yok; PlanComparisonMatrix şemadaki 13+9 anahtarın tamamını gösterir (tripwire test).
- Plan & Erişim'de dahil eklenti "dahil" rozetiyle görünür, satın alınabilir listesine asla düşmez (test).
- Donanımda rent görünmez; ödeme dönüşünde sonuç ekranı; tüm yeni dizgeler 5 dilde.
- tsc/eslint/vitest/backend-e2e/i18n kapıları yeşil.

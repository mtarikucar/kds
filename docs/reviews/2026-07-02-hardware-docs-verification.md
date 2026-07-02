# docs/hardware — Bağımsız Doğrulama Raporu

**Tarih:** 2026-07-02 · **Yöntem:** read-only çok-ajanlı doğrulama (49 ajan; her doküman için kod-temellendirme + TR-regülasyon fact-check + kapsam kritiği; yüksek-önem bulgular ikinci şüpheci ajanla teyit).

**Sonuç:** 178 ham bulgu → **16 çelişki-doğrulanmış sorun** + 2 kapsam notu.

> Bu rapor `docs/hardware/` altındaki cihaz kılavuzlarını **değiştirmez**; onları paralel bir oturum yazdı. Bulgular teyit edilmiştir ancak düzeltmeler operatör onayıyla uygulanır.

---

## Yönetici özeti

Cihaz kılavuzları kapsamlı ve büyük ölçüde doğru (16 SKU'nun tamamı + fiscal/kart-terminali sınıfları, tutarlı 11-bölüm iskeleti, gerçek koda dayalı). İki tür bulgu var:

### 1) Dokümanların ötesinde — gerçek ürün hatası (KOD)

**Caller (arayan-numara) feed'i satın alınsa bile açılmıyor.** `GET /caller/recent` ucu `@RequiresIntegration('caller')` ile kapılı; bu guard `set.integrations['integration.caller']` dizisinin DOLU olmasını ister. Ama `caller_id_integration` add-on'u `feature.callerIntegration: true` verir (FEATURE ad-alanı) — ve hiçbir yer `integration.caller`'ı doldurmaz. Delivery add-on'ları doğru yapar: `integration.delivery: ["yemeksepeti"]`. Sonuç: add-on alan tenant bile calls feed'de **403** alır; sidebar görünür (nav feature ile kapılı, o veriliyor) → *bağlı görünüp çalışmıyor*.

- **Kanıt:** `backend/src/modules/caller/caller.controller.ts:46` (`@RequiresIntegration("caller")`) · `backend/src/modules/subscriptions/guards/plan-feature.guard.ts:199-210` (guard `integration.<domain>` boş-olmayan dizi ister) · `backend/prisma/seeds/seed-marketplace.ts:136` (`grants: { "feature.callerIntegration": true }`) · delivery karşıtlığı `seed-marketplace.ts:106,116,126` · engine yalnız `integration.*` grant'larından doldurur `entitlement-engine.ts:85-96`.
- **Tek-satır düzeltme (iki seçenekten biri):** (a) seed grant'ı `{ "integration.caller": ["generic"] }` yap; **veya** (b) uç noktayı `@RequiresFeature('callerIntegration')` ile kapıla. (a) daha çok delivery kalıbına uyar.
- **Not:** Bu bir KOD hatasıdır, doküman hatası değil — doküman yalnızca amaçlanan davranışı anlatıyor. Ayrı bir branch/PR ile düzeltilmeli (release workflow'a uygun).

### 2) Doküman doğruluk düzeltmeleri (15) — kümeler

- **Bridge/token provizyon akışı (en büyük küme, 8 bulgu):** kılavuzlar köprüyü *6-haneli pairCode → `/v1/devices/pair`*, *heartbeat'te uzayan 24s token*, *WSS `/ws/bridge`* ile anlatıyor. Gerçek: köprü tek-kullanımlık token → `/v1/bridges/claim`, **30 gün** TTL, ajan **giden HTTPS-polling** (`GET /v1/bridges/:id/commands/next`) kullanır (WSS değil). Ayrıca cihaz token'ı **sabit 24s, heartbeat UZATMAZ** (henüz merge edilmemiş renewal fix'i — yani kılavuz shipped-olmayan davranışı anlatıyor). [#5,6,7,8,9,13,15]
- **Para çekmecesi [#14]:** çekmece, *varsayılan yazıcı tanımlı + ödeme NAKİT* iken açılır; `capabilities[]`'e `'cash_drawer'` eklemek yalnız açıklayıcı metadata, aksiyonu açmaz.
- **Ingenico Move/5000F tier [#4]:** doküman `PARTNER_REDIRECT` diyor; seed kategorisi `yazarkasa` → `QUOTE_ONLY` ("Teklif Al"), Hugin/Beko ile aynı.
- **Hugin köprü sürücüsü [#2]:** doküman yalnız `ingenico_iwl`'i scaffold sanıyor; `yazarkasa_hugin.rs` da inert stub. Yalnız `escpos` gerçek → ÖKC/mali köprü yolu henüz işlevsel değil.
- **KDS bump [#10]:** bump'ın caller-id'ye bildirim gönderdiği iddiası yanlış; yalnız POS + garson tabletine gider.
- **Throttle [#11]:** caller webhook'ta "30/dk" reklamı; `default` throttler kayıtlı değil → inert (bilinen altyapı açığı).
- **Regülasyon atıfları:** [#3] Garanti Belgesi → yürürlükteki **13.06.2014 / No. 29029** (2011 metni mülga); [#12] **EÇBS** (Entegre Çevre Bilgi Sistemi, `ecbs.cevre.gov.tr`), "ECBS" değil.
- **HummyBox SKU [#16]:** tablo `BOX-LITE-01`'i "SKU" olarak etiketliyor — o *model*; katalog SKU'ları `hummybox-lite`/`hummybox-pro`.

### 3) Kapsam [C1]
README'nin "kapsanmayan" notu bütünmüş gibi okunuyor — `RESTAURANT_PAGER`/`CUSTOMER_DISPLAY` (kodda referanslı, satılmıyor) da anılmalı. Tartı/metroloji [C2] doğru şekilde dışarıda.

---

## Ek: Her sorunun tam dökümü

### 1. [BLOCKER] 06-arayan-numara.md — consistency/REFUTED
- **Bölüm:** 1. Genel bakış — Yetki ve gizlilik / 7. Sorun giderme / 11. Kontrol listesi
- **İddia:** Caller feed is gated by `@RequiresIntegration('caller')`; buying the caller add-on unlocks it, otherwise the backend rejects ("aksi halde ... backend kabul eder").
- **Kanıt:** caller.controller.ts:46 uses @RequiresIntegration("caller"); PlanFeatureGuard reads set.integrations['integration.caller'] and 403s unless it is a non-empty vendor array (plan-feature.guard.ts:200-209). But the ONLY caller add-on, caller_id_integration, grants feature.callerIntegration:true (seed-marketplace.ts:136) — a FEATURE grant folded into set.features, NOT set.integrations (effective-features.fold.ts:80-104). grep confirms NO grant of integration.caller anywhere in src/ or prisma/. Net: GET /v1/caller/recent 403s even AFTER a tenant buys the caller add-on — the gated feature is unreachable for everyone.
- **Kaynak/yol:** `backend/src/modules/caller/caller.controller.ts:46; backend/src/modules/subscriptions/guards/plan-feature.guard.ts:200; backend/prisma/seeds/seed-marketplace.ts:136`
- **Düzeltme:** Either change the controller gate to @RequiresFeature('callerIntegration') (matching the add-on's feature.callerIntegration grant), or make the seed add-on grant integration.caller:['generic'] (matching the integration gate). Do NOT tell installers the add-on purchase makes the feed work until this is fixed.
- **Nihai öneri (şüpheci teyit, high):** The finding stands (blocker): stop telling installers the caller add-on purchase makes the feed work. Fix at the source, and note the finding's alternative fix needs refinement. Preferred single-point fix: change the seed add-on grant from `feature.callerIntegration: true` to `integration.caller: ['generic']` in backend/prisma/seeds/seed-marketplace.ts:136 (accompanied by a reversible up/down migration/seed adjustment), matching the existing @RequiresIntegration("caller") gate — the fold creates integration domains on the fly, so no enum registration is required. CAUTION: the alternative fix (switch controller to @RequiresFeature('callerIntegration')) is INCOMPLETE as written — callerIntegration is not a registered PlanFeature/feature column, so the fold's `name in features` guard discards the grant; that route would also require adding CALLER_INTEGRATION to the PlanFeature enum and the base feature map. Until fixed, update docs/hardware/06-arayan-numara.md (sections 1, 7, 11) to state the caller feed gate is currently non-functional rather than promising the add-on unlocks it.

### 2. [MAJOR] 00-genel-cerceve.md — code/INACCURATE
- **Bölüm:** 7.1 Kart POS entegrasyon notu (teknik durum) + 5.1 / 8.1 sürücü listesi (satır 219, 302, 341)
- **İddia:** Yalnızca kart terminali sürücüsü (ingenico_iwl) scaffold'dır; yazarkasa_hugin sürücüsü ve escpos sürücüsü köprüde 'mevcuttur/sağlar' (işlevsel ima edilir)
- **Kanıt:** apps/local-bridge-agent/src/drivers/yazarkasa_hugin.rs: '//! Hugin yazarkasa driver. Scaffold only.', try_init()→Ok(None) (l.19-22), execute→'Hugin driver not implemented in this scaffold'. Bu, ingenico_iwl.rs (Ok(None)) ile BİREBİR aynı durumdadır. Yalnızca escpos.rs 'REAL byte-writing implementation'dır. Doküman honest-status notu (l.302) SADECE ingenico'yu scaffold olarak açıklıyor.
- **Kaynak/yol:** `apps/local-bridge-agent/src/drivers/yazarkasa_hugin.rs:19`
- **Düzeltme:** 7.1 teknik durum notunu yazarkasa_hugin sürücüsünü de kapsayacak şekilde genişletin: köprünün Hugin ÖKC sürücüsü de şu an scaffold (try_init→Ok(None)) ve inert. Yalnızca escpos gerçek. Aksi halde ÖKC/mali köprü entegrasyonunun hazır olduğu izlenimi verilir.
- **Nihai öneri (şüpheci teyit, high):** Extend the 7.1 'Kart POS entegrasyon notu (teknik durum)' disclosure (and add a matching caveat at line 219 / 285) to state that the bridge's Hugin ÖKC driver (yazarkasa_hugin) is ALSO currently a scaffold — try_init()→Ok(None), execute() returns 'Hugin driver not implemented in this scaffold' — and therefore inert, identical to ingenico_iwl. Make clear that among the bridge drivers only escpos is a real byte-writing implementation, so the end-to-end ÖKC/GMP-3 fiscal-receipt path via the bridge is not yet functional and 'ÖKC/mali köprü entegrasyonu hazır' izlenimi verilmemelidir. (Any real fiscal-core-side BekoFiscalProvider does not change that the on-prem bridge driver talking to the ÖKC is a stub.)

### 3. [MAJOR] 00-genel-cerceve.md — regulation/OUTDATED
- **Bölüm:** 3.3 Garanti belgesi ve fatura / Kaynaklar
- **İddia:** Garanti Belgesi Yönetmeliği kaynak olarak 'Garanti Belgesi Uygulama Esaslarına Dair Yönetmelik (Resmî Gazete, 24.04.2011)' gösterilmiş
- **Kanıt:** Yürürlükteki düzenleme, 6502 sayılı TKHK'nın 56 ve 84. maddelerine dayanan 'Garanti Belgesi Yönetmeliği', R.G. 13.06.2014 sayı 29029'dur (https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm). Bu yönetmelik eski (4077 dönemi) garanti belgesi düzenlemelerinin yerini almıştır. Doküman 2011 tarihli, artık cari olmayan bir metne link vermektedir.
- **Kaynak/yol:** `https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm`
- **Düzeltme:** Kaynak linkini güncel 'Garanti Belgesi Yönetmeliği (R.G. 13.06.2014, No. 29029)' ile değiştirin; azami tamir süresi için ayrıca 'Satış Sonrası Hizmetler Yönetmeliği (R.G. 13.06.2014, No. 29029)' referansını ekleyin.
- **Nihai öneri (şüpheci teyit, high):** Replace the line-403 source with the current 'Garanti Belgesi Yönetmeliği (Resmî Gazete, 13.06.2014, No. 29029)' → https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm (based on 6502 sayılı TKHK md. 56 ve 84). Optionally add the 'Satış Sonrası Hizmetler Yönetmeliği (R.G. 13.06.2014, No. 29029)' for azami tamir süresi. Note: this is a B2B-focused document where the doc correctly explains the consumer-oriented minimums do not apply to tacirler-arası satış, so the citation fix does not alter the substantive analysis — it only corrects the source link to the in-force regulation.

### 4. [MAJOR] 01-yazarkasa-okc.md — code/REFUTED
- **Bölüm:** §2.3 / §4.2 / §5 / §11 — Ingenico Move/5000F satış tier'ı
- **İddia:** Ingenico Move/5000F mağazada PARTNER_REDIRECT (Tier 2) olarak modellenir / "bu belgede zaten doğru şekilde PARTNER_REDIRECT olarak konumlandırılmıştır"; satış checklist'i bankalı POS = PARTNER_REDIRECT der.
- **Kanıt:** Seed'de Ingenico ürünü `category: "yazarkasa"` ve saleMode override YOK (seed-marketplace.ts:239-254). saleMode kategori-default'tan türetilir (seed-marketplace.ts:1125-1128) ve `CATEGORY_DEFAULT_SALE_MODE.yazarkasa === "QUOTE_ONLY"` (create-hardware-product.dto.ts:47). PARTNER_REDIRECT sadece `pos_terminal` kategorisine map'lenir (dto:48). Yani Move/5000F mağazada QUOTE_ONLY ("Teklif Al") olarak listelenir — Hugin/Beko ile aynı — PARTNER_REDIRECT DEĞİL.
- **Kaynak/yol:** `backend/prisma/seeds/seed-marketplace.ts:239-254; backend/src/modules/catalog/dto/create-hardware-product.dto.ts:47-48`
- **Düzeltme:** Belgeyi düzelt: Ingenico Move/5000F fiscal YN ÖKC olarak seed'de `yazarkasa` kategorisinde ve QUOTE_ONLY tier'ındadır (diğer yazarkasalar gibi "Teklif Al"). PARTNER_REDIRECT'i istiyorsanız ya seed'e `saleMode: "PARTNER_REDIRECT"` per-row override eklenmeli ya da ürün `pos_terminal` kategorisine taşınmalı; aksi halde §2.3/§4.2/§5/§11'deki tüm PARTNER_REDIRECT ifadeleri gerçekle çelişiyor.
- **Nihai öneri (şüpheci teyit, high):** Fix the source of truth mismatch. As currently seeded, Ingenico Move/5000F is a `yazarkasa`-category fiscal YN ÖKC and resolves to QUOTE_ONLY ("Teklif Al") in /admin/store — exactly like Hugin/Beko. Either (a) correct the doc's §2.3/§4.2/§5/§11 to state QUOTE_ONLY (Tier 1) for this SKU, OR (b) if PARTNER_REDIRECT is the intended commercial model, add a per-row `saleMode: "PARTNER_REDIRECT"` override to the seed entry (or recategorize to `pos_terminal`) and then keep the doc as-is. The doc and seed must agree; today they do not.

### 5. [MAJOR] 01-yazarkasa-okc.md — code/INACCURATE
- **Bölüm:** §4.3 adım 1 / §1 — slot köprü arkasına bağlanır (bridgeId set)
- **İddia:** kind=yazarkasa slot oluşturulurken "HummyBox köprüsünün arkasına bağlanır (bridgeId set)"; yazarkasa her zaman bridgeId dolu olacak şekilde provizyonlanır.
- **Kanıt:** Şema `Device.bridgeId` alanını destekler (schema.prisma) ama hiçbir yazma yolu YOK: `CreateDeviceSlotDto` ve `UpdateDeviceDto` bridgeId alanı içermez (device.dto.ts:53-92, :94-124), createSlot input'u bridgeId almaz (device.service.ts:98-113). Backend genelinde Device.bridgeId'ye yazan hiçbir kod yok — device-mesh yalnızca okur (select/orderBy/group: branches.service.ts:207-212). local-bridge.service'teki `bridgeId:` yazımları köprünün KENDİ id'sidir, Device.bridgeId değil.
- **Kaynak/yol:** `backend/src/modules/device-mesh/dto/device.dto.ts:53-124; backend/src/modules/device-mesh/device.service.ts:98-209`
- **Düzeltme:** Ya belgeyi düzelt ("bridgeId set" adımının bugün mevcut bir API/UI ile yapılamadığını, cihazın köprü arkasında olmasının şu an bir Device kaydı ilişkisiyle temsil edilmediğini belirt) ya da eksik olarak işaretle. Aksi halde §4.3 adım 1'i izleyen kurulumcu bridgeId'yi hiçbir yerden set edemez.
- **Nihai öneri (şüpheci teyit, high):** Fix the doc to stop presenting 'bridgeId set' as an installer step. Concretely: (1) In §1 topology and §4.3 adım 1, change the parenthetical from '(bridgeId set)' to a note that the behind-the-bridge relationship is a schema/design concept (Device.bridgeId exists) but is NOT yet populated by any provisioning API or UI — createSlot accepts no bridgeId and no write path sets it (device.service.ts, device.dto.ts). (2) Remove or re-mark the §11 checklist item '[ ] kind = yazarkasa cihaz slotu köprü arkasında (bridgeId set) oluşturuldu' as not-yet-supported, since it cannot be satisfied. (3) Optionally note that today the bridge↔device link is only rendered for topology grouping from whatever bridgeId value exists (which is always null via the current create flow), so devices will display as cloud-direct until a write path is added. Alternatively, flag this as a backend gap: add bridgeId to CreateDeviceSlotDto/UpdateDeviceDto and a validated write path if the behind-the-bridge binding is meant to be real.

### 6. [MAJOR] 02-fis-mutfak-yazici.md — code/INACCURATE
- **Bölüm:** 4.2-B Köprünün eşleştirilmesi (+ Bölüm 11 checklist)
- **İddia:** Bridge pairing: 'Panelde köprü slotu için 6 haneli pairCode üretilir ... HummyBox köprü uygulaması bu pairCode ile POST /v1/devices/pair çağırır.'
- **Kanıt:** LocalBridgeAgent has NO pairCode field — it has provisioningTokenHash (backend/prisma/schema.prisma:4469-4477). The bridge is provisioned via POST /v1/bridges which returns a single-use provisioning token shown once (backend/src/modules/local-bridge/local-bridge.controller.ts:57-60), then claimed via POST /v1/bridges/claim exchanging that token (local-bridge.controller.ts:84-90, local-bridge.service.ts:84-114). The 6-char pairCode + POST /v1/devices/pair flow belongs to cloud-direct DEVICES (tablets/KDS), not bridges (device-mesh/devices.controller.ts:166, device.service.ts:65-69).
- **Kaynak/yol:** `backend/src/modules/local-bridge/local-bridge.controller.ts:57,84`
- **Düzeltme:** Rewrite step 1-2 for the bridge: admin provisions the bridge slot (POST /v1/bridges) and receives a single-use provisioning TOKEN (shown once); the HummyBox agent exchanges it via POST /v1/bridges/claim. Remove the '6 haneli pairCode' and '/v1/devices/pair' from the bridge flow (that is the tablet/KDS device flow).
- **Nihai öneri (şüpheci teyit, high):** Rewrite bridge pairing (section 4.2-B step B and the section 11 checklist bullet) to the real flow: (1) admin provisions the bridge slot via POST /v1/bridges and receives a single-use PROVISIONING TOKEN shown exactly once (never retrievable, stored sha256-hashed as provisioningTokenHash); (2) the HummyBox bridge agent exchanges that provisioning token via POST /v1/bridges/claim for a long-lived bearer token (default 30-day TTL, LOCAL_BRIDGE_TOKEN_TTL_MS — hashed at rest); the claim is single-use/atomic. Remove entirely from the bridge flow: the '6 karakterli alfanumerik pairCode', its '10 dk geçerli' TTL, 'POST /v1/devices/pair', and the '24 saat TTL — DEVICE_TOKEN_TTL_MS' bearer note — all of these are the tablet/KDS Device pairing flow, not the LocalBridgeAgent flow. (The 24h-no-refresh caveat may still be accurate for cloud-direct devices, but not for bridges, whose bearer default is 30 days.)

### 7. [MAJOR] 02-fis-mutfak-yazici.md — code/INACCURATE
- **Bölüm:** 4.2-B Köprünün eşleştirilmesi (+ Bölüm 11 checklist satır 288)
- **İddia:** Bridge bearer token '24 saat TTL' (24s TTL bearer token).
- **Kanıt:** Bridge token TTL default is 30 DAYS, not 24h: LOCAL_BRIDGE_TOKEN_TTL_MS defaults to 30*24*3600*1000 (backend/src/modules/local-bridge/local-bridge.service.ts:30-41,98). 24h is the DEVICE token TTL (DEVICE_TOKEN_TTL_MS default 24*3600*1000, device-mesh/device.service.ts:60-61) — the doc applied the device value to the bridge.
- **Kaynak/yol:** `backend/src/modules/local-bridge/local-bridge.service.ts:41`
- **Düzeltme:** State the bridge bearer token TTL as 30 days (default, override LOCAL_BRIDGE_TOKEN_TTL_MS). Reserve the 24h figure for cloud-direct devices if that flow is documented separately.
- **Nihai öneri (şüpheci teyit, high):** In section 4.2-B and the Bölüm 11 checklist (line 288), state the bridge bearer token TTL as 30 days by default (overridable via LOCAL_BRIDGE_TOKEN_TTL_MS), issued at claim time. The 24-hour TTL applies only to device-mesh (cloud-direct) device tokens (DEVICE_TOKEN_TTL_MS); keep that figure in the device documentation, not the bridge pairing section.

### 8. [MAJOR] 02-fis-mutfak-yazici.md — code/REFUTED
- **Bölüm:** 4.2-B Köprünün eşleştirilmesi
- **İddia:** Bearer token 'her heartbeat'te uzar' (TTL slides/extends on every heartbeat).
- **Kanıt:** Neither the bridge nor the device heartbeat touches tokenExpiresAt. Bridge heartbeat() only writes status/lastSeenAt/hostname/os/agentVersion (backend/src/modules/local-bridge/local-bridge.service.ts:167-182). Device heartbeat() only writes status='online'+lastSeenAt (device-mesh/device.service.ts:558-564). The token expires at its fixed TTL regardless of heartbeats; a slide-on-heartbeat renewal was proposed but is an UNMERGED fix branch.
- **Kaynak/yol:** `backend/src/modules/local-bridge/local-bridge.service.ts:167-182`
- **Düzeltme:** Remove 'her heartbeat'te uzar'. Explain instead that the token has a fixed lifetime (bridge 30d) and, if needed, is renewed via an explicit refresh endpoint — not via heartbeat. Note the fleet will need re-provisioning/refresh at TTL.
- **Nihai öneri (şüpheci teyit, high):** Delete the phrase 'her heartbeat'te uzar'. State instead: the bridge bearer token is issued at pairing time with a FIXED lifetime (bridge default 30 gün, cihaz TTL'i pair/claim anında set edilir) and is NOT extended by heartbeats — heartbeat yalnızca status/lastSeenAt (ve host/os/agentVersion) günceller. Once tokenExpiresAt geçince authenticateToken token'ı reddeder ve köprü/cihaz kimlik doğrulayamaz; şu an merged kodda otomatik yenileme yok, bu yüzden TTL dolduğunda köprü/cihaz yeniden eşleştirilmeli (re-provision). (Not: heartbeat'te-uzatma özelliği yalnızca henüz merge edilmemiş bir fix branch'te öneriliyor.)

### 9. [MAJOR] 02-fis-mutfak-yazici.md — code/INACCURATE
- **Bölüm:** 4.2-C Yazıcının köprüye bağlanması (step 2)
- **İddia:** 'Köprünün yazıcıya erişebilmesi için yazıcının adresi girilir: LAN modellerinde IP:port, BT modelinde Bluetooth adresi/MAC (alan adları panelde teyit edilmeli)' — implying the printer address is a system/panel field.
- **Kanıt:** The cloud never learns/stores the printer LAN address; the transport (tcp host:port, default 9100, or a serial device path) is configured ON-PREM in printers.toml on the bridge (apps/local-bridge-agent/src/drivers/escpos.rs:32-55,83-105,158-187). The cloud Device.config comment lists 'printer width, kitchen station id' — not an IP/MAC address (backend/prisma/schema.prisma:4397-4398). There is also no Bluetooth transport in the driver (only 'tcp' and 'device'/'serial').
- **Kaynak/yol:** `apps/local-bridge-agent/src/drivers/escpos.rs:34`
- **Düzeltme:** Correct step 2: the printer's IP:port is set in the bridge's local printers.toml ([[printer]] transport='tcp', host, port), not in the HummyTummy admin panel. Drop the implication of a panel IP/MAC field; note BT is not a supported bridge transport today.
- **Nihai öneri (şüpheci teyit, high):** Rewrite Section 4.2-C step 2 to reflect the real cloud/bridge split. The cloud/panel only references a printer by a logical id (the command's printerId, default "default") — it never stores or accepts the printer's IP/MAC. The actual transport (LAN raw-TCP host:port, port defaulting to 9100, or a serial/USB device path) is configured ON-PREM in the bridge's data-dir printers.toml as a [[printer]] table (transport="tcp" with host/port, or transport="device"/"serial" with path), matching the local printer's id. Drop the "Bluetooth adresi/MAC" branch: the bridge ESC/POS driver has no Bluetooth transport (only tcp and device/serial), so BT is not a supported bridge transport today — consistent with the Section 2.3 / troubleshooting warnings. Keep panel-side steps (bridgeId assignment, capabilities[], test fiş) as-is, since those are genuine panel operations.

### 10. [MAJOR] 03-kds-ekrani.md — code/INACCURATE
- **Bölüm:** 1. Genel bakis / 3. step 6 / 11. Dogrulama checklist
- **İddia:** Bump (READY) 'hazir' bilgisini POS'a/garson tabletine/caller-id'ye gercek zamanli geri bildirir; validation step 'Bump → POS/garson/caller-id geri bildirimi dondu'
- **Kanıt:** backend/src/modules/caller/caller.service.ts:7-27 — the caller module is INBOUND phone-order ingest only (provider webhook → caller_events row + outbox → UI presence feed); it has no consumer of order READY/bump events and no dispatch to caller_id devices. KDS bump emits only WS emitOrderStatusChange/emitOrderItemStatusChange (backend/src/modules/kds/kds.service.spec.ts:24-26,39-41) to POS/waiter. No caller_id path exists anywhere in orders/kds/device-mesh (grep 'caller_id' hits only the device-kind enum device-mesh.types.ts:13 and CATEGORY map device.service.ts:225).
- **Kaynak/yol:** `backend/src/modules/caller/caller.service.ts:7`
- **Düzeltme:** Remove 'caller-id' from the bump-feedback claim in section 1 (line 20), step 6 (line 100), and the verification checklist (line 295). Bump feedback goes to POS + waiter tablet via WebSocket only; caller_id is an incoming-call feed, not a ready-notification target. Otherwise an installer's verification step tests a path that cannot pass.
- **Nihai öneri (şüpheci teyit, high):** Remove 'caller-id' from the bump-feedback claim in all three locations: section 1 line 20 ("...POS'a/garson tabletine/caller-id'ye..." → "...POS'a/garson tabletine..."), step 6 line 100 (same phrase), and the verification checklist line 295 ("Bump → POS/garson/caller-id geri bildirimi dondu" → "Bump → POS/garson geri bildirimi dondu"). Bump (READY) feedback is emitted via WebSocket only to the kitchen-* and pos-* rooms; caller-id is an inbound phone-call feed, not a ready-notification target. Optionally add a note that customer-session ready notifications go via the separate emitOrderStatusChangeWithCustomer path when a sessionId is present.

### 11. [MAJOR] 06-arayan-numara.md — spec/INACCURATE
- **Bölüm:** 1. Genel bakış — Güvenlik
- **İddia:** Webhook ucu 'dakikada 30 istekle throttle'lıdır' (30 requests/min).
- **Kanıt:** Route is @Throttle({ default: { limit: 30, ttl: 60_000 } }) (caller.controller.ts:83), but ThrottlerModule.forRoot registers throttlers named only 'short' (10/s), 'medium' (50/10s), 'long' (100/min) — there is NO 'default' throttler (app.module.ts:83-99). @nestjs/throttler keys overrides by throttler name, so the 'default' override matches nothing and is inert; the effective per-minute cap is the global 'long' = 100/min, not 30/min.
- **Kaynak/yol:** `backend/src/modules/caller/caller.controller.ts:83; backend/src/app.module.ts:83`
- **Düzeltme:** Register a 'default' throttler (or re-key the decorator to a registered name) so 30/min actually applies, or change the doc to state the effective global caps (10/s + 50/10s + 100/min). Don't advertise an unenforced 30/min control.
- **Nihai öneri (şüpheci teyit, high):** The doc line 25 is inaccurate and should not advertise an unenforced control. Either (a) fix the code so 30/min actually applies — re-key the decorator to a registered throttler or register a 'default' throttler in ThrottlerModule.forRoot — then keep the doc as-is; or (b) correct the doc to state the actually-enforced global caps: 10 req/s (short), 50 req/10s (medium), 100 req/min (long). Preferred is (a) since the webhook comment explicitly relies on a tight 30/min brute-force cap that is currently not in effect.

### 12. [MAJOR] 06-arayan-numara.md — regulation/INACCURATE
- **Bölüm:** 9. Regülasyon ve uyumluluk — AEEE (WEEE)
- **İddia:** üretici/ithalatçı ECBS (Elektronik Cihaz Bilgi Sistemi) portalına kayıt ile toplama/geri dönüşüm yükümlülüklerine tabidir.
- **Kanıt:** The government portal is EÇBS = 'Entegre Çevre Bilgi Sistemi' (Integrated Environmental Information System), run by the Çevre, Şehircilik ve İklim Değişikliği Bakanlığı at ecbs.cevre.gov.tr, where EEE producers/importers register and file AEEE declarations. There is no portal called 'Elektronik Cihaz Bilgi Sistemi'; the acronym expansion in the doc is wrong.
- **Kaynak/yol:** `https://ecbs.cevre.gov.tr/`
- **Düzeltme:** Replace 'ECBS (Elektronik Cihaz Bilgi Sistemi)' with 'EÇBS (Entegre Çevre Bilgi Sistemi, ecbs.cevre.gov.tr)'. The registration mechanism (e-Devlet ile giriş → il müdürlüğüne onay) is otherwise correct.
- **Nihai öneri (şüpheci teyit, high):** In docs/hardware/06-arayan-numara.md line 194, replace 'ECBS (Elektronik Cihaz Bilgi Sistemi) portalına kayıt' with 'EÇBS (Entegre Çevre Bilgi Sistemi, ecbs.cevre.gov.tr) portalına kayıt'. The registration mechanism (e-Devlet ile giriş → il müdürlüğü onayı) and the rest of the AEEE guidance are correct and can stay. Note: the acronym is officially EÇBS (the URL uses 'ecbs' since Ç transliterates to C), so keeping the Ç in the acronym while fixing the expansion is the accurate correction.

### 13. [MAJOR] 07-para-cekmecesi.md — code/REFUTED
- **Bölüm:** 4.2 Sisteme tanıtım — yazıcının eşleştirilmesi
- **İddia:** sha256-hash'li rotating bearer token döner (varsayılan 24 saat TTL — DEVICE_TOKEN_TTL_MS; heartbeat'te uzar, cihaz uzun süre çevrimdışı kalırsa token dolar ve yeniden pair gerekir)
- **Kanıt:** backend/src/modules/device-mesh/device.service.ts:548-584 heartbeat() only writes {status:'online', lastSeenAt} and a deviceLog row — it never touches tokenExpiresAt. tokenExpiresAt is written ONLY at pair (lines 460/490) and read for hard-expiry at authenticateToken:544 (`if (row.tokenExpiresAt < now) return null`). No renewal/slide code exists anywhere in the module (grep for renew/slide/refresh returned nothing). The 'slide token on heartbeat' fix lives only on the unmerged branch fix/device-mesh-token-renewal.
- **Kaynak/yol:** `backend/src/modules/device-mesh/device.service.ts:544`
- **Düzeltme:** Remove 'heartbeat'te uzar'. State the truth: the bearer token hard-expires 24h after pairing REGARDLESS of heartbeat, so a continuously-online LAN printer/bridge stops authenticating (printing + drawer-kick fail) at the 24h mark and must be re-paired until the token-renewal fix is merged.
- **Nihai öneri (şüpheci teyit, high):** Remove the 'heartbeat'te uzar' clause. State accurately: the sha256-hashed bearer token has a fixed TTL (default 24h, DEVICE_TOKEN_TTL_MS) set once at pairing and is NOT renewed by heartbeats. authenticateToken hard-rejects any token past tokenExpiresAt, so even a continuously-online LAN printer/kasa-bridge stops authenticating exactly 24h after pairing — printing and cash-drawer kick fail and the device must be re-paired — until the token-renewal fix (fix/device-mesh-token-renewal) is merged. Recommend bumping DEVICE_TOKEN_TTL_MS to a longer value as an interim mitigation.

### 14. [MAJOR] 07-para-cekmecesi.md — code/REFUTED
- **Bölüm:** 1 Genel Bakış / 4.2 / 11 Kontrol Listesi
- **İddia:** Yazıcının capabilities[] dizisine 'cash_drawer' eklendiğinde POS/masaüstü uygulaması 'Çekmeceyi Aç' aksiyonunu etkinleştirir; çekmeceyi tanıtmak = yazıcının capabilities[] dizisine 'cash_drawer' eklemek
- **Kanıt:** No runtime code reads a 'cash_drawer' capability to gate the drawer. Desktop drawer-pop fires purely on `printerId && method === 'CASH'` (frontend/src/pages/pos/posReceipt.ts:90-94) using the configured default printerId. Device.capabilities[] is only displayed (frontend/src/features/devices/DeviceManagerSection.tsx:183), never read. The desktop printer hardcodes a self-reported feature named 'cash_drawer_control' (not 'cash_drawer') that is always present for any ESC/POS printer (frontend/src-tauri/src/hardware/devices/printers/escpos.rs:198). Grep for 'cash_drawer' across frontend/apps runtime shows zero capability-gating readers.
- **Kaynak/yol:** `frontend/src/pages/pos/posReceipt.ts:90`
- **Düzeltme:** Correct the mechanism: the drawer pops when a default printer is configured (printerId) AND the payment method is CASH — adding 'cash_drawer' to capabilities[] is descriptive metadata only and does NOT enable/gate the action. Move the installer's real requirement (configure the default printer in POS settings) to the checklist.
- **Nihai öneri (şüpheci teyit, high):** Fix the mechanism description: the desktop/POS "Çekmeceyi Aç" action and the auto-pop on cash payments are enabled solely by (a) configuring a default receipt printer in POS settings (`defaultReceiptPrinterId`) and (b) the payment method being CASH — see frontend/src/pages/pos/posReceipt.ts:90. Adding `'cash_drawer'` to the printer's `capabilities[]` is descriptive metadata only; no runtime code reads it to enable or gate the drawer, and any configured ESC/POS printer will already send the drawer-kick. In Section 1, 4.2, and the Section 11 checklist, replace "capabilities[] dizisine 'cash_drawer' eklendiğinde ... etkinleştirir" and "çekmeceyi tanıtmak = capabilities[]'e 'cash_drawer' eklemek" with: the installer's real requirement is to set the branch's default receipt printer in POS settings; optionally tag the printer's capabilities[] with 'cash_drawer' as documentation/inventory metadata, noting it has no functional effect. (Also note the desktop printer's self-reported feature string is `cash_drawer_control`, not `cash_drawer`.)

### 15. [MAJOR] 08-network-bridge-hummybox.md — code/INACCURATE
- **Bölüm:** 1. Genel bakış / 2.2 (Ağ portları düzeltme) / 4.2 / 4.3 / 10
- **İddia:** Köprü buluta kalıcı WSS (yalnız giden bağlantı, /ws/bridge) açar ve device_commands kuyruğundan komutları bu WSS üzerinden çeker; agent 'yalnızca dışarı bağlanır — buluta WSS (/ws/bridge)'.
- **Kanıt:** The shipped Rust agent never opens a websocket. main.rs:199 pulls work via cloud.fetch_more() = HTTP GET /v1/bridges/:id/commands/next (cloud_ws.rs:278); heartbeat is HTTP POST /v1/bridges/heartbeat (telemetry.rs). grep for tungstenite/WebSocket/connect_async in apps/local-bridge-agent/src returns zero hits (tokio-tungstenite is a declared-but-unused dep, Cargo.toml:17), and there is NO /ws/bridge WebSocketGateway anywhere in backend/src. The transport is HTTPS request/response polling, not a persistent WSS. cloud_ws.rs:3-7 itself calls WSS the 'primary channel' with 'REST fallback', but only the REST path is implemented.
- **Kaynak/yol:** `apps/local-bridge-agent/src/main.rs:199`
- **Düzeltme:** Replace 'kalıcı WSS / /ws/bridge' throughout with the real mechanism: outbound HTTPS (443) — the agent POSTs heartbeat and polls GET /v1/bridges/:id/commands/next, ACKs over HTTPS. The 'outbound-only, no inbound port/listener' property still holds; only the protocol name (WSS→HTTPS-poll) and the /ws/bridge endpoint are wrong. Mark true WSS as '(planlanan)'.
- **Nihai öneri (şüpheci teyit, high):** Replace every claim of 'kalıcı WSS / /ws/bridge' as the live transport with the real mechanism: outbound HTTPS on 443 — the agent POSTs heartbeat to /v1/bridges/heartbeat (every 20s), polls GET /v1/bridges/:id/commands/next for work, claims via POST /v1/bridges/claim, and ACKs outcomes via POST /v1/devices/commands/:id/ack, all over rustls HTTPS request/response (no persistent socket, no /ws/bridge endpoint). Keep the load-bearing invariant unchanged (yalnız giden bağlantı, WAN portu açmaz, yerel dinleyici yok) and firewall guidance can stay '443 giden açık' since it already covers HTTPS. Mark true WSS push (and the /ws/bridge gateway) as '(planlanan)', consistent with how the doc already flags keyring storage. Specifically fix lines 21, 56, 71, 74, 91, 126, 137-138, 188, 268, 285.

### 16. [MAJOR] 08-network-bridge-hummybox.md — spec/INACCURATE
- **Bölüm:** 2.3 Ticari koşullar (sabit) / 5.3 / 11
- **İddia:** SKU sütunu: BOX-LITE-01 / BOX-PRO-01 ('Sabit olan SKU ve ticari koşullardır').
- **Kanıt:** In seed-marketplace.ts the catalog SKU is sku:'hummybox-lite' (line 453) and sku:'hummybox-pro' (line 468); BOX-LITE-01/BOX-PRO-01 are the model field (lines 457/472), not the SKU. Cart/quote lookup keys on sku (CartItemService.code === HardwareProduct.sku), so 'BOX-LITE-01' will not resolve as a SKU.
- **Kaynak/yol:** `backend/prisma/seeds/seed-marketplace.ts:453`
- **Düzeltme:** Relabel the table column to 'Model' for BOX-LITE-01/BOX-PRO-01, and add the actual catalog SKUs (hummybox-lite / hummybox-pro).
- **Nihai öneri (şüpheci teyit, high):** Relabel the section 2.3 column from 'SKU' to 'Model' (values BOX-LITE-01 / BOX-PRO-01 are the HardwareProduct.model field), and add a separate authoritative SKU column showing the real catalog SKUs hummybox-lite / hummybox-pro (the identifiers the cart/quote engine resolves via findBySkuOrThrow). Also adjust the 'Sabit olan SKU...' prose (and the section 9.6 'model/SKU' mention) so the fixed-SKU claim points at the resolvable lowercase catalog SKU rather than the model code.

## Kapsam notları (tam)

### C1. [MINOR] consistency/INACCURATE
- **İddia:** "Kapsama girmeyen 'önerilen ekipman' (ör. tartı/metroloji cihazları, RECOMMENDED_ONLY tier) ayrıca belgelenmemiştir." — implies scale/metrology is the sole referenced-but-undocumented device class.
- **Düzeltme:** Expand the exclusion note to also name restoran çağrı cihazı/pager (RESTAURANT_PAGER) ve müşteri ekranı (CUSTOMER_DISPLAY) as referenced-in-code-but-not-sold/not-provisioned classes, or reword to 've benzeri henüz satılmayan/provizyonlanmayan legacy cihaz tipleri' so the list isn't read as exhaustive.

### C2. [INFO] gap/CONFIRMED
- **İddia:** tartı/metroloji cihazları (scale) are RECOMMENDED_ONLY and deliberately not documented — is this gap real and should scale be documented?
- **Düzeltme:** No documentation action required while scale remains a placeholder category with zero sellable SKUs and no Device.kind. If a scale SKU is ever added to PRODUCTS (moving it off RECOMMENDED_ONLY to DIRECT_SALE with compliance docs) or a Device.kind=scale is introduced, add a 10-XX scale doc with the standard 11 sections and drop it from the exclusion note.


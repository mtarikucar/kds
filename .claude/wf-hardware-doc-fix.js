export const meta = {
  name: 'hardware-doc-fix',
  description: 'Apply verified corrections to docs/hardware device manuals (1 agent/file, idempotent re-verify-then-fix, minimal diffs)',
  phases: [{ title: 'Fix' }],
}

// Per-file confirmed findings (from the read-only verification, each
// adversarially re-checked). Embedded so the script needs no fs access.
const FIX_MAP = {
  "docs/hardware/00-genel-cerceve.md": [
    {
      "severity": "major",
      "verdict": "INACCURATE",
      "category": "code",
      "section": "7.1 Kart POS entegrasyon notu (teknik durum) + 5.1 / 8.1 sürücü listesi (satır 219, 302, 341)",
      "claim": "Yalnızca kart terminali sürücüsü (ingenico_iwl) scaffold'dır; yazarkasa_hugin sürücüsü ve escpos sürücüsü köprüde 'mevcuttur/sağlar' (işlevsel ima edilir)",
      "evidence": "apps/local-bridge-agent/src/drivers/yazarkasa_hugin.rs: '//! Hugin yazarkasa driver. Scaffold only.', try_init()→Ok(None) (l.19-22), execute→'Hugin driver not implemented in this scaffold'. Bu, ingenico_iwl.rs (Ok(None)) ile BİREBİR aynı durumdadır. Yalnızca escpos.rs 'REAL byte-writing implementation'dır. Doküman honest-status notu (l.302) SADECE ingenico'yu scaffold olarak açıklıyor.",
      "sourceOrPath": "apps/local-bridge-agent/src/drivers/yazarkasa_hugin.rs:19",
      "fix": "Extend the 7.1 'Kart POS entegrasyon notu (teknik durum)' disclosure (and add a matching caveat at line 219 / 285) to state that the bridge's Hugin ÖKC driver (yazarkasa_hugin) is ALSO currently a scaffold — try_init()→Ok(None), execute() returns 'Hugin driver not implemented in this scaffold' — and therefore inert, identical to ingenico_iwl. Make clear that among the bridge drivers only escpos is a real byte-writing implementation, so the end-to-end ÖKC/GMP-3 fiscal-receipt path via the bridge is not yet functional and 'ÖKC/mali köprü entegrasyonu hazır' izlenimi verilmemelidir. (Any real fiscal-core-side BekoFiscalProvider does not change that the on-prem bridge driver talking to the ÖKC is a stub.)"
    },
    {
      "severity": "major",
      "verdict": "OUTDATED",
      "category": "regulation",
      "section": "3.3 Garanti belgesi ve fatura / Kaynaklar",
      "claim": "Garanti Belgesi Yönetmeliği kaynak olarak 'Garanti Belgesi Uygulama Esaslarına Dair Yönetmelik (Resmî Gazete, 24.04.2011)' gösterilmiş",
      "evidence": "Yürürlükteki düzenleme, 6502 sayılı TKHK'nın 56 ve 84. maddelerine dayanan 'Garanti Belgesi Yönetmeliği', R.G. 13.06.2014 sayı 29029'dur (https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm). Bu yönetmelik eski (4077 dönemi) garanti belgesi düzenlemelerinin yerini almıştır. Doküman 2011 tarihli, artık cari olmayan bir metne link vermektedir.",
      "sourceOrPath": "https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm",
      "fix": "Replace the line-403 source with the current 'Garanti Belgesi Yönetmeliği (Resmî Gazete, 13.06.2014, No. 29029)' → https://www.resmigazete.gov.tr/eskiler/2014/06/20140613-2.htm (based on 6502 sayılı TKHK md. 56 ve 84). Optionally add the 'Satış Sonrası Hizmetler Yönetmeliği (R.G. 13.06.2014, No. 29029)' for azami tamir süresi. Note: this is a B2B-focused document where the doc correctly explains the consumer-oriented minimums do not apply to tacirler-arası satış, so the citation fix does not alter the substantive analysis — it only corrects the source link to the in-force regulation."
    }
  ],
  "docs/hardware/01-yazarkasa-okc.md": [
    {
      "severity": "major",
      "verdict": "REFUTED",
      "category": "code",
      "section": "§2.3 / §4.2 / §5 / §11 — Ingenico Move/5000F satış tier'ı",
      "claim": "Ingenico Move/5000F mağazada PARTNER_REDIRECT (Tier 2) olarak modellenir / \"bu belgede zaten doğru şekilde PARTNER_REDIRECT olarak konumlandırılmıştır\"; satış checklist'i bankalı POS = PARTNER_REDIRECT der.",
      "evidence": "Seed'de Ingenico ürünü `category: \"yazarkasa\"` ve saleMode override YOK (seed-marketplace.ts:239-254). saleMode kategori-default'tan türetilir (seed-marketplace.ts:1125-1128) ve `CATEGORY_DEFAULT_SALE_MODE.yazarkasa === \"QUOTE_ONLY\"` (create-hardware-product.dto.ts:47). PARTNER_REDIRECT sadece `pos_terminal` kategorisine map'lenir (dto:48). Yani Move/5000F mağazada QUOTE_ONLY (\"Teklif Al\") olarak listelenir — Hugin/Beko ile aynı — PARTNER_REDIRECT DEĞİL.",
      "sourceOrPath": "backend/prisma/seeds/seed-marketplace.ts:239-254; backend/src/modules/catalog/dto/create-hardware-product.dto.ts:47-48",
      "fix": "Fix the source of truth mismatch. As currently seeded, Ingenico Move/5000F is a `yazarkasa`-category fiscal YN ÖKC and resolves to QUOTE_ONLY (\"Teklif Al\") in /admin/store — exactly like Hugin/Beko. Either (a) correct the doc's §2.3/§4.2/§5/§11 to state QUOTE_ONLY (Tier 1) for this SKU, OR (b) if PARTNER_REDIRECT is the intended commercial model, add a per-row `saleMode: \"PARTNER_REDIRECT\"` override to the seed entry (or recategorize to `pos_terminal`) and then keep the doc as-is. The doc and seed must agree; today they do not."
    },
    {
      "severity": "major",
      "verdict": "INACCURATE",
      "category": "code",
      "section": "§4.3 adım 1 / §1 — slot köprü arkasına bağlanır (bridgeId set)",
      "claim": "kind=yazarkasa slot oluşturulurken \"HummyBox köprüsünün arkasına bağlanır (bridgeId set)\"; yazarkasa her zaman bridgeId dolu olacak şekilde provizyonlanır.",
      "evidence": "Şema `Device.bridgeId` alanını destekler (schema.prisma) ama hiçbir yazma yolu YOK: `CreateDeviceSlotDto` ve `UpdateDeviceDto` bridgeId alanı içermez (device.dto.ts:53-92, :94-124), createSlot input'u bridgeId almaz (device.service.ts:98-113). Backend genelinde Device.bridgeId'ye yazan hiçbir kod yok — device-mesh yalnızca okur (select/orderBy/group: branches.service.ts:207-212). local-bridge.service'teki `bridgeId:` yazımları köprünün KENDİ id'sidir, Device.bridgeId değil.",
      "sourceOrPath": "backend/src/modules/device-mesh/dto/device.dto.ts:53-124; backend/src/modules/device-mesh/device.service.ts:98-209",
      "fix": "Fix the doc to stop presenting 'bridgeId set' as an installer step. Concretely: (1) In §1 topology and §4.3 adım 1, change the parenthetical from '(bridgeId set)' to a note that the behind-the-bridge relationship is a schema/design concept (Device.bridgeId exists) but is NOT yet populated by any provisioning API or UI — createSlot accepts no bridgeId and no write path sets it (device.service.ts, device.dto.ts). (2) Remove or re-mark the §11 checklist item '[ ] kind = yazarkasa cihaz slotu köprü arkasında (bridgeId set) oluşturuldu' as not-yet-supported, since it cannot be satisfied. (3) Optionally note that today the bridge↔device link is only rendered for topology grouping from whatever bridgeId value exists (which is always null via the current create flow), so devices will display as cloud-direct until a write path is added. Alternatively, flag this as a backend gap: add bridgeId to CreateDeviceSlotDto/UpdateDeviceDto and a validated write path if the behind-the-bridge binding is meant to be real."
    }
  ],
  "docs/hardware/02-fis-mutfak-yazici.md": [
    {
      "severity": "major",
      "verdict": "INACCURATE",
      "category": "code",
      "section": "4.2-B Köprünün eşleştirilmesi (+ Bölüm 11 checklist)",
      "claim": "Bridge pairing: 'Panelde köprü slotu için 6 haneli pairCode üretilir ... HummyBox köprü uygulaması bu pairCode ile POST /v1/devices/pair çağırır.'",
      "evidence": "LocalBridgeAgent has NO pairCode field — it has provisioningTokenHash (backend/prisma/schema.prisma:4469-4477). The bridge is provisioned via POST /v1/bridges which returns a single-use provisioning token shown once (backend/src/modules/local-bridge/local-bridge.controller.ts:57-60), then claimed via POST /v1/bridges/claim exchanging that token (local-bridge.controller.ts:84-90, local-bridge.service.ts:84-114). The 6-char pairCode + POST /v1/devices/pair flow belongs to cloud-direct DEVICES (tablets/KDS), not bridges (device-mesh/devices.controller.ts:166, device.service.ts:65-69).",
      "sourceOrPath": "backend/src/modules/local-bridge/local-bridge.controller.ts:57,84",
      "fix": "Rewrite bridge pairing (section 4.2-B step B and the section 11 checklist bullet) to the real flow: (1) admin provisions the bridge slot via POST /v1/bridges and receives a single-use PROVISIONING TOKEN shown exactly once (never retrievable, stored sha256-hashed as provisioningTokenHash); (2) the HummyBox bridge agent exchanges that provisioning token via POST /v1/bridges/claim for a long-lived bearer token (default 30-day TTL, LOCAL_BRIDGE_TOKEN_TTL_MS — hashed at rest); the claim is single-use/atomic. Remove entirely from the bridge flow: the '6 karakterli alfanumerik pairCode', its '10 dk geçerli' TTL, 'POST /v1/devices/pair', and the '24 saat TTL — DEVICE_TOKEN_TTL_MS' bearer note — all of these are the tablet/KDS Device pairing flow, not the LocalBridgeAgent flow. (The 24h-no-refresh caveat may still be accurate for cloud-direct devices, but not for bridges, whose bearer default is 30 days.)"
    },
    {
      "severity": "major",
      "verdict": "INACCURATE",
      "category": "code",
      "section": "4.2-B Köprünün eşleştirilmesi (+ Bölüm 11 checklist satır 288)",
      "claim": "Bridge bearer token '24 saat TTL' (24s TTL bearer token).",
      "evidence": "Bridge token TTL default is 30 DAYS, not 24h: LOCAL_BRIDGE_TOKEN_TTL_MS defaults to 30*24*3600*1000 (backend/src/modules/local-bridge/local-bridge.service.ts:30-41,98). 24h is the DEVICE token TTL (DEVICE_TOKEN_TTL_MS default 24*3600*1000, device-mesh/device.service.ts:60-61) — the doc applied the device value to the bridge.",
      "sourceOrPath": "backend/src/modules/local-bridge/local-bridge.service.ts:41",
      "fix": "In section 4.2-B and the Bölüm 11 checklist (line 288), state the bridge bearer token TTL as 30 days by default (overridable via LOCAL_BRIDGE_TOKEN_TTL_MS), issued at claim time. The 24-hour TTL applies only to device-mesh (cloud-direct) device tokens (DEVICE_TOKEN_TTL_MS); keep that figure in the device documentation, not the bridge pairing section."
    },
    {
      "severity": "major",
      "verdict": "REFUTED",
      "category": "code",
      "section": "4.2-B Köprünün eşleştirilmesi",
      "claim": "Bearer token 'her heartbeat'te uzar' (TTL slides/extends on every heartbeat).",
      "evidence": "Neither the bridge nor the device heartbeat touches tokenExpiresAt. Bridge heartbeat() only writes status/lastSeenAt/hostname/os/agentVersion (backend/src/modules/local-bridge/local-bridge.service.ts:167-182). Device heartbeat() only writes status='online'+lastSeenAt (device-mesh/device.service.ts:558-564). The token expires at its fixed TTL regardless of heartbeats; a slide-on-heartbeat renewal was proposed but is an UNMERGED fix branch.",
      "sourceOrPath": "backend/src/modules/local-bridge/local-bridge.service.ts:167-182",
      "fix": "Delete the phrase 'her heartbeat'te uzar'. State instead: the bridge bearer token is issued at pairing time with a FIXED lifetime (bridge default 30 gün, cihaz TTL'i pair/claim anında set edilir) and is NOT extended by heartbeats — heartbeat yalnızca status/lastSeenAt (ve host/os/agentVersion) günceller. Once tokenExpiresAt geçince authenticateToken token'ı reddeder ve köprü/cihaz kimlik doğrulayamaz; şu an merged kodda otomatik yenileme yok, bu yüzden TTL dolduğunda köprü/cihaz yeniden eşleştirilmeli (re-provision). (Not: heartbeat'te-uzatma özelliği yalnızca henüz merge edilmemiş bir fix branch'te öneriliyor.)"
    },
    {
      "severity": "major",
      "verdict": "INACCURATE",
      "category": "code",
      "section": "4.2-C Yazıcının köprüye bağlanması (step 2)",
      "claim": "'Köprünün yazıcıya erişebilmesi için yazıcının adresi girilir: LAN modellerinde IP:port, BT modelinde Bluetooth adresi/MAC (alan adları panelde teyit edilmeli)' — implying the printer address is a system/panel field.",
      "evidence": "The cloud never learns/stores the printer LAN address; the transport (tcp host:port, default 9100, or a serial device path) is configured ON-PREM in printers.toml on the bridge (apps/local-bridge-agent/src/drivers/escpos.rs:32-55,83-105,158-187). The cloud Device.config comment lists 'printer width, kitchen station id' — not an IP/MAC address (backend/prisma/schema.prisma:4397-4398). There is also no Bluetooth transport in the driver (only 'tcp' and 'device'/'serial').",
      "sourceOrPath": "apps/local-bridge-agent/src/drivers/escpos.rs:34",
      "fix": "Rewrite Section 4.2-C step 2 to reflect the real cloud/bridge split. The cloud/panel only references a printer by a logical id (the command's printerId, default \"default\") — it never stores or accepts the printer's IP/MAC. The actual transport (LAN raw-TCP host:port, port defaulting to 9100, or a serial/USB device path) is configured ON-PREM in the bridge's data-dir printers.toml as a [[printer]] table (transport=\"tcp\" with host/port, or transport=\"device\"/\"serial\" with path), matching the local printer's id. Drop the \"Bluetooth adresi/MAC\" branch: the bridge ESC/POS driver has no Bluetooth transport (only tcp and device/serial), so BT is not a supported bridge transport today — consistent with the Section 2.3 / troubleshooting warnings. Keep panel-side steps (bridgeId assignment, capabilities[], test fiş) as-is, since those are genuine panel operations."
    }
  ],
  "docs/hardware/03-kds-ekrani.md": [
    {
      "severity": "major",
      "verdict": "INACCURATE",
      "category": "code",
      "section": "1. Genel bakis / 3. step 6 / 11. Dogrulama checklist",
      "claim": "Bump (READY) 'hazir' bilgisini POS'a/garson tabletine/caller-id'ye gercek zamanli geri bildirir; validation step 'Bump → POS/garson/caller-id geri bildirimi dondu'",
      "evidence": "backend/src/modules/caller/caller.service.ts:7-27 — the caller module is INBOUND phone-order ingest only (provider webhook → caller_events row + outbox → UI presence feed); it has no consumer of order READY/bump events and no dispatch to caller_id devices. KDS bump emits only WS emitOrderStatusChange/emitOrderItemStatusChange (backend/src/modules/kds/kds.service.spec.ts:24-26,39-41) to POS/waiter. No caller_id path exists anywhere in orders/kds/device-mesh (grep 'caller_id' hits only the device-kind enum device-mesh.types.ts:13 and CATEGORY map device.service.ts:225).",
      "sourceOrPath": "backend/src/modules/caller/caller.service.ts:7",
      "fix": "Remove 'caller-id' from the bump-feedback claim in all three locations: section 1 line 20 (\"...POS'a/garson tabletine/caller-id'ye...\" → \"...POS'a/garson tabletine...\"), step 6 line 100 (same phrase), and the verification checklist line 295 (\"Bump → POS/garson/caller-id geri bildirimi dondu\" → \"Bump → POS/garson geri bildirimi dondu\"). Bump (READY) feedback is emitted via WebSocket only to the kitchen-* and pos-* rooms; caller-id is an inbound phone-call feed, not a ready-notification target. Optionally add a note that customer-session ready notifications go via the separate emitOrderStatusChangeWithCustomer path when a sessionId is present."
    }
  ],
  "docs/hardware/06-arayan-numara.md": [
    {
      "severity": "blocker",
      "verdict": "REFUTED",
      "category": "consistency",
      "section": "1. Genel bakış — Yetki ve gizlilik / 7. Sorun giderme / 11. Kontrol listesi",
      "claim": "Caller feed is gated by `@RequiresIntegration('caller')`; buying the caller add-on unlocks it, otherwise the backend rejects (\"aksi halde ... backend kabul eder\").",
      "evidence": "caller.controller.ts:46 uses @RequiresIntegration(\"caller\"); PlanFeatureGuard reads set.integrations['integration.caller'] and 403s unless it is a non-empty vendor array (plan-feature.guard.ts:200-209). But the ONLY caller add-on, caller_id_integration, grants feature.callerIntegration:true (seed-marketplace.ts:136) — a FEATURE grant folded into set.features, NOT set.integrations (effective-features.fold.ts:80-104). grep confirms NO grant of integration.caller anywhere in src/ or prisma/. Net: GET /v1/caller/recent 403s even AFTER a tenant buys the caller add-on — the gated feature is unreachable for everyone.",
      "sourceOrPath": "backend/src/modules/caller/caller.controller.ts:46; backend/src/modules/subscriptions/guards/plan-feature.guard.ts:200; backend/prisma/seeds/seed-marketplace.ts:136",
      "fix": "The finding stands (blocker): stop telling installers the caller add-on purchase makes the feed work. Fix at the source, and note the finding's alternative fix needs refinement. Preferred single-point fix: change the seed add-on grant from `feature.callerIntegration: true` to `integration.caller: ['generic']` in backend/prisma/seeds/seed-marketplace.ts:136 (accompanied by a reversible up/down migration/seed adjustment), matching the existing @RequiresIntegration(\"caller\") gate — the fold creates integration domains on the fly, so no enum registration is required. CAUTION: the alternative fix (switch controller to @RequiresFeature('callerIntegration')) is INCOMPLETE as written — callerIntegration is not a registered PlanFeature/feature column, so the fold's `name in features` guard discards the grant; that route would also require adding CALLER_INTEGRATION to the PlanFeature enum and the base feature map. Until fixed, update docs/hardware/06-arayan-numara.md (sections 1, 7, 11) to state the caller feed gate is currently non-functional rather than promising the add-on unlocks it."
    },
    {
      "severity": "major",
      "verdict": "INACCURATE",
      "category": "spec",
      "section": "1. Genel bakış — Güvenlik",
      "claim": "Webhook ucu 'dakikada 30 istekle throttle'lıdır' (30 requests/min).",
      "evidence": "Route is @Throttle({ default: { limit: 30, ttl: 60_000 } }) (caller.controller.ts:83), but ThrottlerModule.forRoot registers throttlers named only 'short' (10/s), 'medium' (50/10s), 'long' (100/min) — there is NO 'default' throttler (app.module.ts:83-99). @nestjs/throttler keys overrides by throttler name, so the 'default' override matches nothing and is inert; the effective per-minute cap is the global 'long' = 100/min, not 30/min.",
      "sourceOrPath": "backend/src/modules/caller/caller.controller.ts:83; backend/src/app.module.ts:83",
      "fix": "The doc line 25 is inaccurate and should not advertise an unenforced control. Either (a) fix the code so 30/min actually applies — re-key the decorator to a registered throttler or register a 'default' throttler in ThrottlerModule.forRoot — then keep the doc as-is; or (b) correct the doc to state the actually-enforced global caps: 10 req/s (short), 50 req/10s (medium), 100 req/min (long). Preferred is (a) since the webhook comment explicitly relies on a tight 30/min brute-force cap that is currently not in effect."
    },
    {
      "severity": "major",
      "verdict": "INACCURATE",
      "category": "regulation",
      "section": "9. Regülasyon ve uyumluluk — AEEE (WEEE)",
      "claim": "üretici/ithalatçı ECBS (Elektronik Cihaz Bilgi Sistemi) portalına kayıt ile toplama/geri dönüşüm yükümlülüklerine tabidir.",
      "evidence": "The government portal is EÇBS = 'Entegre Çevre Bilgi Sistemi' (Integrated Environmental Information System), run by the Çevre, Şehircilik ve İklim Değişikliği Bakanlığı at ecbs.cevre.gov.tr, where EEE producers/importers register and file AEEE declarations. There is no portal called 'Elektronik Cihaz Bilgi Sistemi'; the acronym expansion in the doc is wrong.",
      "sourceOrPath": "https://ecbs.cevre.gov.tr/",
      "fix": "In docs/hardware/06-arayan-numara.md line 194, replace 'ECBS (Elektronik Cihaz Bilgi Sistemi) portalına kayıt' with 'EÇBS (Entegre Çevre Bilgi Sistemi, ecbs.cevre.gov.tr) portalına kayıt'. The registration mechanism (e-Devlet ile giriş → il müdürlüğü onayı) and the rest of the AEEE guidance are correct and can stay. Note: the acronym is officially EÇBS (the URL uses 'ecbs' since Ç transliterates to C), so keeping the Ç in the acronym while fixing the expansion is the accurate correction."
    }
  ],
  "docs/hardware/07-para-cekmecesi.md": [
    {
      "severity": "major",
      "verdict": "REFUTED",
      "category": "code",
      "section": "4.2 Sisteme tanıtım — yazıcının eşleştirilmesi",
      "claim": "sha256-hash'li rotating bearer token döner (varsayılan 24 saat TTL — DEVICE_TOKEN_TTL_MS; heartbeat'te uzar, cihaz uzun süre çevrimdışı kalırsa token dolar ve yeniden pair gerekir)",
      "evidence": "backend/src/modules/device-mesh/device.service.ts:548-584 heartbeat() only writes {status:'online', lastSeenAt} and a deviceLog row — it never touches tokenExpiresAt. tokenExpiresAt is written ONLY at pair (lines 460/490) and read for hard-expiry at authenticateToken:544 (`if (row.tokenExpiresAt < now) return null`). No renewal/slide code exists anywhere in the module (grep for renew/slide/refresh returned nothing). The 'slide token on heartbeat' fix lives only on the unmerged branch fix/device-mesh-token-renewal.",
      "sourceOrPath": "backend/src/modules/device-mesh/device.service.ts:544",
      "fix": "Remove the 'heartbeat'te uzar' clause. State accurately: the sha256-hashed bearer token has a fixed TTL (default 24h, DEVICE_TOKEN_TTL_MS) set once at pairing and is NOT renewed by heartbeats. authenticateToken hard-rejects any token past tokenExpiresAt, so even a continuously-online LAN printer/kasa-bridge stops authenticating exactly 24h after pairing — printing and cash-drawer kick fail and the device must be re-paired — until the token-renewal fix (fix/device-mesh-token-renewal) is merged. Recommend bumping DEVICE_TOKEN_TTL_MS to a longer value as an interim mitigation."
    },
    {
      "severity": "major",
      "verdict": "REFUTED",
      "category": "code",
      "section": "1 Genel Bakış / 4.2 / 11 Kontrol Listesi",
      "claim": "Yazıcının capabilities[] dizisine 'cash_drawer' eklendiğinde POS/masaüstü uygulaması 'Çekmeceyi Aç' aksiyonunu etkinleştirir; çekmeceyi tanıtmak = yazıcının capabilities[] dizisine 'cash_drawer' eklemek",
      "evidence": "No runtime code reads a 'cash_drawer' capability to gate the drawer. Desktop drawer-pop fires purely on `printerId && method === 'CASH'` (frontend/src/pages/pos/posReceipt.ts:90-94) using the configured default printerId. Device.capabilities[] is only displayed (frontend/src/features/devices/DeviceManagerSection.tsx:183), never read. The desktop printer hardcodes a self-reported feature named 'cash_drawer_control' (not 'cash_drawer') that is always present for any ESC/POS printer (frontend/src-tauri/src/hardware/devices/printers/escpos.rs:198). Grep for 'cash_drawer' across frontend/apps runtime shows zero capability-gating readers.",
      "sourceOrPath": "frontend/src/pages/pos/posReceipt.ts:90",
      "fix": "Fix the mechanism description: the desktop/POS \"Çekmeceyi Aç\" action and the auto-pop on cash payments are enabled solely by (a) configuring a default receipt printer in POS settings (`defaultReceiptPrinterId`) and (b) the payment method being CASH — see frontend/src/pages/pos/posReceipt.ts:90. Adding `'cash_drawer'` to the printer's `capabilities[]` is descriptive metadata only; no runtime code reads it to enable or gate the drawer, and any configured ESC/POS printer will already send the drawer-kick. In Section 1, 4.2, and the Section 11 checklist, replace \"capabilities[] dizisine 'cash_drawer' eklendiğinde ... etkinleştirir\" and \"çekmeceyi tanıtmak = capabilities[]'e 'cash_drawer' eklemek\" with: the installer's real requirement is to set the branch's default receipt printer in POS settings; optionally tag the printer's capabilities[] with 'cash_drawer' as documentation/inventory metadata, noting it has no functional effect. (Also note the desktop printer's self-reported feature string is `cash_drawer_control`, not `cash_drawer`.)"
    }
  ],
  "docs/hardware/08-network-bridge-hummybox.md": [
    {
      "severity": "major",
      "verdict": "INACCURATE",
      "category": "code",
      "section": "1. Genel bakış / 2.2 (Ağ portları düzeltme) / 4.2 / 4.3 / 10",
      "claim": "Köprü buluta kalıcı WSS (yalnız giden bağlantı, /ws/bridge) açar ve device_commands kuyruğundan komutları bu WSS üzerinden çeker; agent 'yalnızca dışarı bağlanır — buluta WSS (/ws/bridge)'.",
      "evidence": "The shipped Rust agent never opens a websocket. main.rs:199 pulls work via cloud.fetch_more() = HTTP GET /v1/bridges/:id/commands/next (cloud_ws.rs:278); heartbeat is HTTP POST /v1/bridges/heartbeat (telemetry.rs). grep for tungstenite/WebSocket/connect_async in apps/local-bridge-agent/src returns zero hits (tokio-tungstenite is a declared-but-unused dep, Cargo.toml:17), and there is NO /ws/bridge WebSocketGateway anywhere in backend/src. The transport is HTTPS request/response polling, not a persistent WSS. cloud_ws.rs:3-7 itself calls WSS the 'primary channel' with 'REST fallback', but only the REST path is implemented.",
      "sourceOrPath": "apps/local-bridge-agent/src/main.rs:199",
      "fix": "Replace every claim of 'kalıcı WSS / /ws/bridge' as the live transport with the real mechanism: outbound HTTPS on 443 — the agent POSTs heartbeat to /v1/bridges/heartbeat (every 20s), polls GET /v1/bridges/:id/commands/next for work, claims via POST /v1/bridges/claim, and ACKs outcomes via POST /v1/devices/commands/:id/ack, all over rustls HTTPS request/response (no persistent socket, no /ws/bridge endpoint). Keep the load-bearing invariant unchanged (yalnız giden bağlantı, WAN portu açmaz, yerel dinleyici yok) and firewall guidance can stay '443 giden açık' since it already covers HTTPS. Mark true WSS push (and the /ws/bridge gateway) as '(planlanan)', consistent with how the doc already flags keyring storage. Specifically fix lines 21, 56, 71, 74, 91, 126, 137-138, 188, 268, 285."
    },
    {
      "severity": "major",
      "verdict": "INACCURATE",
      "category": "spec",
      "section": "2.3 Ticari koşullar (sabit) / 5.3 / 11",
      "claim": "SKU sütunu: BOX-LITE-01 / BOX-PRO-01 ('Sabit olan SKU ve ticari koşullardır').",
      "evidence": "In seed-marketplace.ts the catalog SKU is sku:'hummybox-lite' (line 453) and sku:'hummybox-pro' (line 468); BOX-LITE-01/BOX-PRO-01 are the model field (lines 457/472), not the SKU. Cart/quote lookup keys on sku (CartItemService.code === HardwareProduct.sku), so 'BOX-LITE-01' will not resolve as a SKU.",
      "sourceOrPath": "backend/prisma/seeds/seed-marketplace.ts:453",
      "fix": "Relabel the section 2.3 column from 'SKU' to 'Model' (values BOX-LITE-01 / BOX-PRO-01 are the HardwareProduct.model field), and add a separate authoritative SKU column showing the real catalog SKUs hummybox-lite / hummybox-pro (the identifiers the cart/quote engine resolves via findBySkuOrThrow). Also adjust the 'Sabit olan SKU...' prose (and the section 9.6 'model/SKU' mention) so the fixed-SKU claim points at the resolvable lowercase catalog SKU rather than the model code."
    }
  ],
  "docs/hardware/README.md": [
    {
      "severity": "minor",
      "verdict": "INACCURATE",
      "category": "consistency",
      "section": "Ortak Konular — kapsam dışı notu (satır 53)",
      "claim": "\"Kapsama girmeyen 'önerilen ekipman' (ör. tartı/metroloji cihazları, RECOMMENDED_ONLY tier) ayrıca belgelenmemiştir.\" — implies scale/metrology is the sole referenced-but-undocumented device class.",
      "evidence": "The codebase references two additional peripheral device classes that are equally undocumented and equally not-sold/not-provisioned: RESTAURANT_PAGER (çağrı/pager cihazı) and CUSTOMER_DISPLAY (müşteri/pole display). Both appear in frontend/src/types/hardware.ts DeviceType enum (RESTAURANT_PAGER line 5, CUSTOMER_DISPLAY line 7; PagerCalled HardwareEvent line 163) and in backend/src/modules/settings/integrations/integrations.service.ts getHardwareConfig hardwareTypes (lines 327-333: RESTAURANT_PAGER, CUSTOMER_DISPLAY, SCALE_DEVICE). Like scale, neither has a seeded SKU in seed-marketplace.ts PRODUCTS nor a Device.kind in the mesh registry (schema.prisma:4370-4372 kind list). The note singling out only tartı gives a false impression of exhaustiveness.",
      "sourceOrPath": "frontend/src/types/hardware.ts:5,7; backend/src/modules/settings/integrations/integrations.service.ts:327-333",
      "fix": "Expand the exclusion note to also name restoran çağrı cihazı/pager (RESTAURANT_PAGER) ve müşteri ekranı (CUSTOMER_DISPLAY) as referenced-in-code-but-not-sold/not-provisioned classes, or reword to 've benzeri henüz satılmayan/provizyonlanmayan legacy cihaz tipleri' so the list isn't read as exhaustive."
    }
  ]
};

// The caller add-on grant bug was ALREADY fixed in code this session:
// backend/prisma/seeds/seed-marketplace.ts now grants `integration.caller`
// (was `feature.callerIntegration`). So for 06-arayan-numara.md the doc should
// describe the CORRECT, working contract, not a broken one.
const CALLER_CODE_FIXED_NOTE =
  'NOTE: The related code bug was just fixed — the caller_id_integration add-on now grants ' +
  '`integration.caller: ["generic"]`, which satisfies the frontend FeatureGate integration ' +
  '{domain:"caller"} (route + sidebar) AND the backend @RequiresIntegration("caller"). So the ' +
  'doc must describe this as the WORKING contract: buying the add-on unlocks the feed. Do not ' +
  'describe it as broken/rejecting.';

const OUTCOME_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['file', 'results'],
  properties: {
    file: { type: 'string' },
    results: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['section', 'outcome', 'detail'],
        properties: {
          section: { type: 'string' },
          outcome: { type: 'string', enum: ['fixed', 'already-correct', 'adjusted', 'skipped'] },
          detail: { type: 'string', description: 'the old->new snippet actually changed, or why no change' },
        },
      },
    },
    notes: { type: 'string' },
  },
};

const fixPrompt = (file, findings) => {
  const isCaller = file.endsWith('06-arayan-numara.md');
  return [
    'You are a careful technical editor. Apply verified corrections to ONE Turkish device manual.',
    'Repo root: /home/tarik/Projects/kds  ·  File: ' + file,
    '',
    'RULES (strict):',
    '- Fix ONLY the specific defects listed below. Change nothing else.',
    '- Make the SMALLEST possible edit that makes each claim correct. Preserve the surrounding',
    '  Turkish wording, tone, headings, tables, and formatting. Do NOT restructure or rewrite sections.',
    '- IDEMPOTENT: first read the CURRENT file and re-verify each defect still exists (a parallel',
    '  writer may have already fixed some). For code-grounded claims, open the cited repo path and',
    '  confirm the truth yourself before editing. If the current text is already correct, make NO',
    '  edit for that item and report outcome "already-correct".',
    '- Never introduce a NEW inaccuracy. If unsure what the correct value is, re-check the repo/source;',
    '  if still unsure, report "skipped" with why rather than guessing.',
    '- Keep every edit consistent across the whole file (if a wrong value appears in section 1, the',
    '  operation section, AND the checklist, fix all occurrences).',
    isCaller ? CALLER_CODE_FIXED_NOTE : '',
    '',
    'DEFECTS TO CORRECT (' + findings.length + '):',
    findings.map((f, i) =>
      (i + 1) + '. [' + f.severity + '/' + f.verdict + '] section: ' + f.section +
      '\n   Claim in doc (wrong): ' + f.claim +
      '\n   Evidence/truth: ' + f.evidence +
      '\n   Source/path: ' + (f.sourceOrPath || '-') +
      '\n   Apply: ' + f.fix
    ).join('\n'),
    '',
    'Use Read to load the file and Edit to make surgical changes. After editing, report per-item',
    'outcome with the exact old->new snippet you changed. Return ONLY the structured result.',
  ].filter(Boolean).join('\n');
};

phase('Fix');
const files = Object.keys(FIX_MAP);
log('Applying corrections to ' + files.length + ' device manuals (1 agent/file, idempotent).');

const results = await parallel(
  files.map((file) => () =>
    agent(fixPrompt(file, FIX_MAP[file]), {
      label: 'fix:' + file.split('/').pop(),
      phase: 'Fix',
      schema: OUTCOME_SCHEMA,
      effort: 'high',
    })
  )
);

const clean = results.filter(Boolean);
const tally = { fixed: 0, 'already-correct': 0, adjusted: 0, skipped: 0 };
for (const r of clean) for (const item of (r.results || [])) tally[item.outcome] = (tally[item.outcome] || 0) + 1;

return { tally, byFile: clean };

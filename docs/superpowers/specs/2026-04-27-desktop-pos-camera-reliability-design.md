# Desktop + POS + Camera Reliability — Design

**Date:** 2026-04-27 · **Branch:** `test` · **Status:** awaiting user approval

## 1. Problem statement

The user asked for "mistakeless desktop with POS, CAMERA integrations." A targeted reliability audit + spot-checks of the source revealed three **verified bugs** that will fail in production today, plus four **likely bugs** that match the audit but were not yet line-verified:

### Verified (read the source ourselves)

| ID | Location | What's broken |
|---|---|---|
| **A** | `desktop/src-tauri/src/main.rs` ↔ `frontend/src/lib/tauri.ts` | The frontend `HardwareService` invokes 7 Tauri commands that don't exist in the Rust `invoke_handler`: `initialize_hardware`, `list_devices`, `get_device_status`, `test_device`, `print_kitchen_order`, `open_cash_drawer`, `call_pager`. The deprecated `PrinterService` invokes 3 more that also don't exist: `list_printers`, `set_printer`, `get_printer`. Result: `frontend/src/components/desktop/PrinterSettings.tsx` (calls `PrinterService.listPrinters` on mount) and `frontend/src/components/hardware/HardwareDeviceCard.tsx` (calls `HardwareService.connectDevice/disconnectDevice/testDevice`) throw `Unknown command` at runtime. The hardware-management UI is non-functional. |
| **B** | `frontend/src/pages/pos/POSPage.tsx` payment-success handler | `printReceipt` is only called from `PrinterSettings.tsx:80` (the "Test print" button). No call site in the POS payment-success path or the kitchen-order-create path. Receipts and kitchen tickets do not auto-print today. |
| **C** | `backend/src/modules/analytics/gateways/analytics.gateway.ts:478` | `getDeviceConfig` returns `cameraUrl: camera.streamUrl` to the edge device. `streamUrl` is stored AES-GCM-encrypted (`camera.service.ts:53`); the admin API path correctly decrypts it (`camera.service.ts:315`); the WebSocket-to-edge path forgot to. The C++ edge device receives ciphertext, hands it to GStreamer as an RTSP URL, and silently fails to connect to the camera. Camera analytics is broken end-to-end. |

### Likely (consistent with the audit, not yet line-verified)

| ID | Where | What's wrong |
|---|---|---|
| **D** | `frontend/src/pages/pos/POSPage.tsx` create-order + create-payment mutations | No client-side `idempotencyKey`. Backend supports them; frontend never populates them. Double-tap on a slow network = duplicate orders/payments. |
| **E** | `desktop/src-tauri/src/bluetooth.rs` print pipeline | UTF-8 string bytes are sent raw to the ESC/POS printer; no code page set (e.g., CP-857 for Turkish, ESC `t` 28). Turkish characters (ç, ğ, ı, ö, ş, ü) will mojibake on most thermal printers. |
| **F** | `edge-device-cpp/src/websocket_client.cpp` | Occupancy events emitted while the WebSocket is disconnected are dropped on the floor. No client-side ring buffer + flush-on-reconnect. |
| **G** | edge-device-cpp emit JSON ↔ backend `EdgeOccupancyDataDto` | C++ emits `grid_x`/`grid_z` (snake_case), backend DTO expects `gridX`/`gridZ` (camelCase). class-validator silently rejects. Verify and align. |

## 2. Scope and decomposition

The original ask spans 4 sub-projects (continue review, fix all findings, infra/CI hardening, desktop-POS-camera reliability). This design covers **only the desktop-POS-camera reliability** sub-project. The other three are deferred to follow-up sessions.

Within this sub-project, work is split into **three phases** that can ship as independent commits/PRs. Phasing is the price we pay for not breaking what already works.

```
Phase 1 — Fix the verified bugs (A, B, C)
   ↓
Phase 2 — Fix the likely bugs after spot-checking (D, E, F, G)
   ↓
Phase 3 — Hardening (BLE state machine, retry/backoff, MTU chunking, auto-update rollback, Sentry)
```

Each phase ends in a verifiable state. We do not start Phase 2 until Phase 1 is merged and tested.

## 3. Phase 1 — Fix the verified bugs

### 3.1 Bug C — decrypt camera stream URL on the WebSocket path

**Effort:** XS · **Risk:** None (symmetric with the existing admin-API path).

**Change:** In `backend/src/modules/analytics/gateways/analytics.gateway.ts`, around line 478, the line

```ts
return {
  cameraId: camera.id,
  cameraUrl: camera.streamUrl,        // <-- ciphertext today
  calibration: camera.calibrationData as ...,
};
```

becomes

```ts
import { decryptString } from '...';   // already imported in camera.service.ts

return {
  cameraId: camera.id,
  cameraUrl: camera.streamUrl ? decryptString(camera.streamUrl) : '',
  calibration: camera.calibrationData as ...,
};
```

Or, better, route through `cameraService.getStreamUrlForDevice(cameraId, tenantId)` which already exists (`camera.service.ts:343`: `return decryptString(encrypted)`). That keeps the decrypt in one place.

**Wire-format note:** the edge device receives a plaintext RTSP URL over an authenticated, TLS-protected WebSocket. The URL is short-lived (sent once per device-config event), and the C++ side does not log it. No new exposure surface.

**Verification:**
1. Unit test: `getDeviceConfig` returns the same URL the admin API returns (sans `redactStreamUrl`).
2. End-to-end: with a real RTSP camera (or a `gst-rtsp-server` test fixture), boot the edge device, observe it connects to the camera and emits occupancy events.

### 3.2 Bug B — wire receipt + kitchen-ticket print into the POS workflow

**Effort:** S · **Risk:** Low (additive; gated on `isTauri()`).

**Decisions to make in the implementation plan, not here:**
- Where the receipt content is built (frontend vs backend)
- What happens when no printer is paired (toast warning + log? blocking?)
- Whether to fire-and-forget the print or block payment-success on print success

**This design's commitment:**
1. After `createPayment.onSuccess` in `POSPage.tsx`, call `HardwareService.printReceipt(deviceId, receiptData)` — but only if `isTauri()` and a default receipt printer is configured.
2. After a kitchen-order is created (either via mutation success in `POSPage.tsx` or via socket `order:new` in a new background hook), call `HardwareService.printKitchenOrder(deviceId, ...)` — same gates.
3. Persist receipt JSON on the backend `Payment` row (new `receiptSnapshot Json?` column) so it can be reprinted and audited even if the printer was offline at print-time.
4. New "Reprint Receipt" button on the order detail / payment list, calls `HardwareService.printReceipt` with the stored snapshot.

**Failure-mode policy:** A failed print never blocks payment success. Errors surface as a toast + Sentry breadcrumb. Receipt is queued for reprint. (Reprint queue: out of scope this phase — for now, manual reprint via the new button.)

**Files modified:**
- `backend/prisma/schema.prisma` — add `receiptSnapshot Json?` to `Payment` (and `kitchenTicketSnapshot Json?` to `Order`); migration.
- `backend/src/modules/orders/services/payments.service.ts` — write snapshot at create-time.
- `backend/src/modules/orders/services/orders.service.ts` — write kitchen ticket snapshot at create-time.
- `frontend/src/pages/pos/POSPage.tsx` — call print on payment success.
- `frontend/src/features/pos/hooks/usePosSocket.ts` (or equivalent) — call kitchen-print on `order:new` socket event when running in Tauri.
- `frontend/src/components/orders/PaymentDetail.tsx` (or wherever payment detail lives) — Reprint button.

**Verification:**
1. With desktop app + paired printer: complete a payment → receipt prints automatically.
2. With desktop app + printer disconnected: payment succeeds, toast shows "receipt queued for reprint", "Reprint" button visible on the payment.
3. In web mode (`isTauri() === false`): no print attempted, no errors, no warnings.
4. Snapshot survives backend restart and is replayable via the Reprint button on a different desktop machine.

### 3.3 Bug A — implement the missing Tauri commands (tiered)

**Effort:** M (Tier 1) → L (Tier 1+2) · **Risk:** Medium — biggest change in this design.

The frontend declares 7 device types and 4 connection types. Implementing all of them on the Rust side is a multi-week project. We tier the work:

#### Tier 1 — Must-have for "POS works on desktop" (this phase)

| Tauri command | Implementation notes |
|---|---|
| `initialize_hardware { backendUrl }` | Initializes `HardwareManager` (extends today's `BluetoothManager`); loads persisted `HardwareConfig` from `~/.kds/hardware.json` (Tauri `appDir`); on device entries with `auto_connect: true`, attempts connection in background and emits `DeviceConnected` / `ConnectionError` events. |
| `list_devices` | Returns `Vec<DeviceStatus>` for all configured devices, with live `connection_status` and `health`. |
| `get_device_status { deviceId }` | Returns single `DeviceStatus`. |
| `add_device { config: DeviceConfig }` (new — frontend will need it too) | Persists config to `hardware.json`. Returns the saved entry. |
| `remove_device { deviceId }` | Removes from config. |
| `connect_device { deviceId }` | Already exists for BLE; extend to Serial (printer over serial port, USB-CDC) and Network (TCP printer over LAN) for THERMAL_PRINTER. |
| `disconnect_device { deviceId }` | Already exists for BLE; extend. |
| `test_device { deviceId }` | For THERMAL_PRINTER: prints a small test receipt. For CASH_DRAWER: opens drawer. |
| `print_receipt { deviceId, receipt: ReceiptData }` | Already exists for BLE; extend to Serial + Network connection types. **Set CP-857 code page (Bug E).** |
| `print_kitchen_order { deviceId, order: KitchenOrderData }` | New. Same path as `print_receipt`, different ESC/POS template (no totals, larger item names, no QR). |
| `open_cash_drawer { deviceId }` | Sends ESC/POS pulse command (`ESC p 0 25 250` = pin 2, 25ms × 4ms = ~100ms pulse) over the printer connection. Cash drawer is a peripheral of the printer. **Note:** the configured device for the drawer is typically the printer's deviceId, not a separate device. |
| `list_printers` (legacy `PrinterService`) | Maps to `list_devices` filtered to THERMAL_PRINTER and Serial connection. Keep for backwards compat with `PrinterSettings.tsx` until the new UI replaces it. |
| `set_printer { port }` (legacy) | Sets the default printer to the device with that serial port. |
| `get_printer` (legacy) | Returns default printer port or null. |
| `hardware-event` (Tauri event, emitted from Rust → JS) | One channel for: DeviceConnected, DeviceDisconnected, ConnectionError, PaperOut, PaperLow, CashDrawerOpened, BarcodeScanned, PagerCalled, DeviceError. Frontend already subscribes via `HardwareService.listenToHardwareEvents`. |

**Defer to Tier 2 — DELETE the corresponding frontend wrappers in this phase** (verified no UI calls them, so removal is safe and unambiguous):
- `HardwareService.callPager` (`tauri.ts:183-202`) — restaurant pagers vary wildly by vendor (Long Range Systems, JTECH, etc.); each has its own RF / network protocol. Don't do speculatively. **Action: delete the JS wrapper now; remove `RESTAURANT_PAGER` from the device-type filters until we revive it.**
- `HardwareService.getDeviceStatus` (`tauri.ts:63-74`) — no UI calls it (only `listDevices` is used). **Action: delete the JS wrapper.**
- `BARCODE_READER` device-type support — most USB barcode readers act as keyboards (no Tauri command needed; just a `keydown` listener with a prefix-detection state machine). Plan as Tier 2 *non-Tauri* work.
- `SCALE_DEVICE`, `CUSTOMER_DISPLAY` — defer.

**UI consumers we verified by grep** (these are the ones Tier 1 MUST make work, on real hardware):

| Method | Called from |
|---|---|
| `HardwareService.initialize` | `IntegrationsSettingsPage.tsx:40` |
| `HardwareService.listenToHardwareEvents` | `IntegrationsSettingsPage.tsx:58` |
| `HardwareService.listDevices` | `IntegrationsSettingsPage.tsx:79` |
| `HardwareService.testDevice` | `IntegrationsSettingsPage.tsx:197`, `HardwareDeviceCard.tsx:80` |
| `HardwareService.connectDevice` | `HardwareDeviceCard.tsx:58` |
| `HardwareService.disconnectDevice` | `HardwareDeviceCard.tsx:69` |
| `HardwareService.printReceipt` | `PrinterSettings.tsx:80` (test only — Phase 1 §3.2 adds POS callsite) |
| `PrinterService.listPrinters` / `setPrinter` / `getPrinter` / `printReceipt` | `PrinterSettings.tsx:25-80` (legacy serial-port flow — keep working until UI is replaced) |

**UI consumers we'll ADD in Phase 1** (no callsite today):

| Method | Will be called from |
|---|---|
| `HardwareService.printKitchenOrder` | `usePosSocket.ts` on `order:new` (only when `isTauri()`) |
| `HardwareService.openCashDrawer` | `POSPage.tsx` payment-success when `paymentMethod === 'CASH'` |
| (new) Reprint button | `PaymentDetail.tsx` → `HardwareService.printReceipt(snapshot)` |

**Tier 2 — Next phase / month** (see §5):
- Barcode reader as a USB-HID device (or as keystroke capture in the web app).
- Pager support for one specific vendor (need user to tell us which model they own).
- Scale device for weighed items (deli/butcher use case).

**Tier 3 — When asked for**:
- Customer display, secondary screen, generic USB-HID router.

#### Architecture for Tier 1

Refactor `desktop/src-tauri/src/`:
```
src/
├── main.rs                  // Tauri entrypoint; AppState; command registrations
├── hardware/
│   ├── mod.rs               // HardwareManager (replaces today's BluetoothManager as the public surface)
│   ├── config.rs            // HardwareConfig + DeviceConfig serde; load/save ~/.kds/hardware.json
│   ├── status.rs            // DeviceStatus tracking, last_activity, error_message
│   ├── events.rs            // HardwareEvent enum + emit helper
│   └── connection/
│       ├── mod.rs           // Connection trait { open, write, read, close, healthcheck }
│       ├── bluetooth.rs     // moved from today's bluetooth.rs; implements Connection
│       ├── serial.rs        // serialport crate; Connection impl
│       └── network.rs       // tokio::net::TcpStream; Connection impl
├── escpos/
│   ├── mod.rs               // PrinterCommand enum (moved from bluetooth.rs); CP-857 transcoder
│   ├── receipt.rs           // ReceiptData → Vec<PrinterCommand>
│   ├── kitchen.rs           // KitchenOrderData → Vec<PrinterCommand>
│   └── cash_drawer.rs       // pulse command builder
└── tauri_commands.rs        // thin layer: invoke handlers that call hardware/escpos modules
```

**Persistence:** hardware config in `~/.kds/hardware.json` via Tauri's `app_dir` (cross-platform). NOT in the backend DB — desktop hardware is per-machine (each restaurant terminal has its own printer/drawer pairing).

**Concurrency:** `Arc<RwLock<HardwareManager>>` in `AppState`. The manager owns `HashMap<DeviceId, Box<dyn Connection>>` (active connections) and `HashMap<DeviceId, DeviceStatus>` (cached status). Each device has its own `tokio::sync::Mutex` for serialized writes (the print queue is implicit in the per-device mutex — no two prints to the same device interleave).

**Events:** hardware events emitted via `app_handle.emit_all("hardware-event", &event)`. Frontend listener already exists at `tauri.ts:215`.

#### Bug E (Turkish encoding) folded into Tier 1

Inside `escpos/mod.rs`, before sending any `TextLine` bytes:
1. Send `ESC t 18` (decimal) once on `Initialize` — selects code page 18 (CP-857, Turkish).
2. Transcode each `TextLine` from UTF-8 to CP-857 via a small lookup table for the Turkish letter set (ç → 0x87, ğ → 0xA6, ı → 0x8D, ö → 0x94, ş → 0x9F, ü → 0x81, plus uppercase variants). Unknown bytes → '?'.
3. Add a unit test that round-trips a fixture string with all Turkish characters and asserts the byte sequence.

**Verification:**
1. Unit test in Rust: each Tauri command returns a typed shape that matches `frontend/src/types/hardware.ts`.
2. Build the desktop app; settings page loads without "Unknown command" errors.
3. With a real serial thermal printer: `add_device` → `connect_device` → `test_device` produces a printed test page with Turkish characters legible.
4. With BLE printer: same flow.
5. With cash drawer attached to the printer: `open_cash_drawer { deviceId: printerId }` opens it.
6. `hardware-event` emitted on each connect / disconnect / error.

## 4. Phase 2 — Verify & fix the likely bugs

Each likely bug starts with a verification step before fix. We don't compound speculative fixes on top of partly-fixed foundations.

### 4.1 Bug D — frontend idempotency keys for orders & payments

**Verify:** in `POSPage.tsx`, `OrderCart.tsx`, and the `useCreateOrder` / `useCreatePayment` hooks, search for `idempotencyKey`. If absent, add a `crypto.randomUUID()` generated at button-press-time (NOT at every render — bind it to the click handler ref).

**Backend:** confirm `payments.service.ts:62-78` already supports it (audit-confirmed earlier); add the same support to `orders.service.ts` create-order if missing.

**Verification:** integration test that POSTs the same `idempotencyKey` twice and asserts only one order/payment row exists.

### 4.2 Bug E — already folded into Tier 1 (§3.3). No separate phase.

### 4.3 Bug F — edge-device occupancy ring buffer

**Verify in `edge-device-cpp/src/websocket_client.cpp`:** look at the `send_occupancy` (or equivalent) method. If it `return`s when `!is_connected()`, the data is dropped. Confirm.

**Fix:** add an `std::deque<EdgeOccupancyData>` ring buffer (capped at, say, 600 items = 10 min @ 1 Hz aggregated). On reconnect, drain the buffer in batches of 50 with backoff between batches. On overflow (buffer full + still disconnected), drop the oldest item with a warning log.

**Wire-protocol consideration:** add an optional `bufferedAt` field to `EdgeOccupancyDataDto` so the backend can distinguish real-time from replayed events for analytics quality reporting. (Optional — not breaking.)

**Verification:** with a network namespace cutoff for 2 minutes, observe the device emits all events on reconnect, no duplicates on the backend, occupancy timeline is continuous.

### 4.4 Bug G — wire-protocol JSON-key naming

**Verify:** look at the C++ JSON serialization in `edge-device-cpp/src/edge_device_data.cpp` (or wherever `EdgeOccupancyData::to_json` lives). Compare key names to backend `EdgeOccupancyDataDto`.

**Fix one of:**
- Change C++ to emit camelCase (preferred — backend DTOs are the source of truth).
- Or change backend DTOs to accept both via class-transformer aliases.

**Verification:** integration test that serializes a fixture C++ message and asserts the backend DTO validation passes.

## 5. Phase 3 — Hardening

After Phases 1–2 are merged and verified in staging, the following items from the just-completed code review become next-up:

- **BLE state machine:** explicit `Idle → Scanning → Connecting → Connected → Disconnecting → Idle` enum in `connection/bluetooth.rs`; reject transitions that violate the FSM.
- **Retry/backoff on connect:** exponential 250ms / 500ms / 1s / 2s / give up — emit `ConnectionError` with attempt count.
- **MTU-aware chunking** in `escpos/mod.rs`: query the BLE peripheral MTU before send; chunk commands; per-chunk ack pending (BLE write-with-response, not `WriteWithoutResponse`).
- **Health check / keep-alive:** ESC/POS status request (`GS r 1`) every 30s on idle connections; transition to `ConnectionError` on no response.
- **Auto-update rollback:** Tauri updater plugin's signature check + a "previous binary" fallback path on startup if the new binary fails its first health-self-check.
- **Edge-device backpressure:** circuit-breaker on the WebSocket client (open after 5 consecutive send failures, half-open after 30s). Avoid thundering herd on backend recovery.
- **Edge-device backend JWT validation:** verify the backend's signed config messages so a hijacked WebSocket can't push a malicious calibration matrix.
- **Hardware Sentry breadcrumb integration:** Rust → Tauri event → frontend Sentry SDK → upstream. Right now Rust panics are local-only.

These are individually small but bundled they're another ~3–5 days. Out of scope for the first design pass; opens as a follow-up plan after Phases 1–2 merge.

## 6. Out of scope (this design)

Explicitly NOT covered here:

- The other 3 sub-projects (continue review for infra/CI/desktop/edge/segmentation/etc., fix backend+frontend P0/P1/P2/P3 from `docs/CODE_REVIEW.md`, infra/CI hardening). Each gets its own design.
- Tier 2 hardware (barcode reader, pager, scale).
- Segmentation-service implementation (folder is empty save for `requirements.txt`; appears to be a planned future service, not currently integrated).
- Replacing `PrinterSettings.tsx` UI with a new hardware-management page. The legacy serial-port-based UI keeps working (Tier 1 implements the legacy commands too); a new combined UI is a follow-up design.
- Multi-printer routing (one tenant, multiple kitchens, route ticket to printer X vs printer Y based on item category). Out of scope.
- Network discovery (mDNS/Bonjour) for IP printers. Out of scope; user enters IP manually for now.

## 7. Files modified (across all three phases)

**Backend:**
- `backend/src/modules/analytics/gateways/analytics.gateway.ts` (Bug C, ~1 line)
- `backend/src/modules/analytics/services/camera.service.ts` (helper extraction if we route through `getStreamUrlForDevice`)
- `backend/prisma/schema.prisma` + new migration (`receiptSnapshot`, `kitchenTicketSnapshot`)
- `backend/src/modules/orders/services/payments.service.ts` (Bug B, snapshot write)
- `backend/src/modules/orders/services/orders.service.ts` (Bug B, kitchen ticket snapshot)
- `backend/src/modules/orders/services/orders.service.ts` (Bug D if needed)

**Frontend:**
- `frontend/src/pages/pos/POSPage.tsx` (Bug B, Bug D)
- `frontend/src/features/pos/hooks/usePosSocket.ts` (Bug B kitchen-print on order:new)
- `frontend/src/components/orders/PaymentDetail.tsx` (Bug B Reprint button)
- `frontend/src/api/orders.ts` (Bug D — pass idempotencyKey)
- `frontend/src/lib/tauri.ts` (cleanup of any commands we decide to drop)

**Desktop (Rust) — Tier 1 expansion:**
- `desktop/src-tauri/src/main.rs` (rewrite invoke_handler)
- `desktop/src-tauri/src/hardware/{mod,config,status,events}.rs` (new)
- `desktop/src-tauri/src/hardware/connection/{mod,bluetooth,serial,network}.rs` (new; bluetooth moved)
- `desktop/src-tauri/src/escpos/{mod,receipt,kitchen,cash_drawer}.rs` (new)
- `desktop/src-tauri/src/tauri_commands.rs` (new)
- `desktop/src-tauri/Cargo.toml` (add `serialport`, possibly `mdns` later)

**Edge device (C++) — Phase 2:**
- `edge-device-cpp/src/websocket_client.cpp` (Bug F ring buffer)
- `edge-device-cpp/src/edge_device_data.cpp` (Bug G JSON key naming)

## 8. Verification (whole sub-project)

Each phase has its own verification (above). At the end:

1. Manual end-to-end smoke test on a real deployment: open desktop app → pair printer → take order → send to kitchen (kitchen ticket prints) → mark ready → pay (receipt prints, cash drawer opens for cash) → reprint receipt → verify in backend DB that `receiptSnapshot` is stored.
2. Camera analytics smoke test: provision an edge device → see it register → see occupancy events flowing → cut network for 2 minutes → see events buffered and replayed on reconnect → no holes in the heatmap.
3. Regression: log in as a web-only user (no Tauri) → POS workflow still works, no print attempts, no errors.
4. Regression: existing BLE printer flow (the only working path today) still works after the refactor.

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Refactoring `bluetooth.rs` into `hardware/` breaks the one working flow | Move via mechanical extract first (no logic changes), then add the new modules. PR splits enable bisection. |
| Cross-platform serial-port enumeration (`serialport` crate) is fiddly on macOS / Windows | Keep a minimal whitelist of known-good FTDI / CH340 / Prolific VID:PIDs as a fallback; document the manual config path. |
| New `receiptSnapshot` column requires migration on prod tenants | Migration is additive (nullable column); zero downtime. Backfill not needed (only new payments populate it). |
| User-installed printer drivers / firmware vary; CP-857 is not universal | Make code page selectable per-device (default CP-857). Add a "test print" that prints a Turkish-character row before vs after each common code page so the user can pick. |
| Edge-device ring buffer grows unbounded if RAM is tight on Jetson Nano | Cap at 600 entries by default; configurable. Drop-oldest with a counter logged on each drop. |

## 10. Plan handoff

Once approved, the next step is the **writing-plans** skill, which converts this design into step-by-step implementation plans (one per phase, since each phase is itself a multi-day undertaking and benefits from independent review and merge).

Recommended plan order: **Phase 1.1 (Bug C, ~XS)** → **Phase 1.2 (Bug B + receipt persistence, ~S)** → **Phase 1.3 (Bug A Tier 1 + Bug E, ~M-L; biggest individual deliverable)** → **Phase 2 (likely-bug verifications + fixes, ~M)** → **Phase 3 (hardening, ~L; opens after Phase 1+2 merge)**. Phase 1.1 and 1.2 are short enough that they could merge as a single "small fixes" PR; 1.3 deserves its own.

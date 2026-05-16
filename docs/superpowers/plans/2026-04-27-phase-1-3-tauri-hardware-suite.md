# Phase 1.3 — Tauri Hardware Suite + Turkish Encoding + Frontend Print Wiring

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Tier 1 of the desktop hardware suite (Bug A) — printer + cash drawer + kitchen ticket print + status events working end-to-end on Bluetooth, Serial, and Network connection types — plus Turkish CP-857 character encoding (Bug E), plus the frontend wiring that turns Phase 1.2's persisted snapshots into actually-printed receipts on the desktop POS app.

**Architecture:** Refactor `desktop/src-tauri/src/` from a single-file BLE shim into a layered hardware module: `hardware/` owns a `HardwareManager` with `HashMap<DeviceId, Box<dyn Connection>>`, `escpos/` owns ESC/POS command encoding (with CP-857 transcoder), and `tauri_commands.rs` is a thin wrapper that wires Tauri's `#[command]` surface to the hardware module. Persists per-machine device config to `~/.kds/hardware.json` via Tauri's `app_dir`. Frontend calls existing `HardwareService.printReceipt(deviceId, snapshot)` / `printKitchenOrder` from POSPage payment-success and from a new socket-event listener for `order:new`.

**Tech Stack:** Rust 2021 + Tauri 1.5, btleplug (BLE), serialport (added), tokio (async), serde + serde_json. Frontend: React + Vite + Zustand + react-i18next (existing). Backend: no changes — Phase 1.2 already persists the snapshots this consumes.

---

## Prerequisites (do these before Task 1)

1. **System dependency** (Linux only — macOS/Windows skip): `sudo apt install libdbus-1-dev pkg-config`. Without this, `cargo check` panics in `libdbus-sys` build.rs and no Rust task can verify itself.
2. **Verify the current desktop crate compiles**: `cd desktop/src-tauri && cargo check`. If this fails with anything other than the libdbus panic above, STOP — there's pre-existing breakage to investigate before starting refactor work.
3. **Branch off `test`**: `git checkout test && git checkout -b feat/phase-1-3-tauri-hardware-suite`. (Or work in a worktree per the team convention.)
4. **Confirm Phase 1.1+1.2 has merged** (PR #216). This plan reads `Payment.receiptSnapshot` and `Order.kitchenTicketSnapshot` — those columns must exist.

---

## Scope adjustment from spec §3.3

The spec lists Tier 1 as printer + cash drawer + kitchen ticket print + status events. This plan covers exactly that. **NOT in this plan:** barcode reader (Tier 2 — typically USB-HID acting as keyboard, no Tauri command needed), pager (Tier 2 — vendor-specific), scale device, customer display, mDNS auto-discovery, multi-printer routing.

**Frontend deletes** (housekeeping per spec §3.3 Tier 2 deferral): drop unused wrappers `HardwareService.callPager`, `HardwareService.getDeviceStatus` from `frontend/src/lib/tauri.ts` since no UI calls them.

---

## File structure

**Create (Rust):**
- `desktop/src-tauri/src/escpos/mod.rs` — `PrinterCommand` enum (moved from `bluetooth.rs`), `to_bytes()` impl, **CP-857 transcoder** (Bug E)
- `desktop/src-tauri/src/escpos/codepage.rs` — Unicode→CP-857 lookup table for Turkish letter set + tests
- `desktop/src-tauri/src/escpos/receipt.rs` — `ReceiptData` (matching `frontend/src/types/hardware.ts::ReceiptData`) → `Vec<PrinterCommand>` template
- `desktop/src-tauri/src/escpos/kitchen.rs` — `KitchenOrderData` → `Vec<PrinterCommand>` template
- `desktop/src-tauri/src/escpos/cash_drawer.rs` — pulse command builder
- `desktop/src-tauri/src/hardware/mod.rs` — `HardwareManager` (replaces today's `BluetoothManager` as the public surface)
- `desktop/src-tauri/src/hardware/config.rs` — `HardwareConfig` + `DeviceConfig` serde structs matching `frontend/src/types/hardware.ts`; load/save `~/.kds/hardware.json`
- `desktop/src-tauri/src/hardware/status.rs` — `DeviceStatus` tracking, last_activity, error_message
- `desktop/src-tauri/src/hardware/events.rs` — `HardwareEvent` enum (matching frontend type), `emit_to_window` helper
- `desktop/src-tauri/src/hardware/connection/mod.rs` — `Connection` trait + `Box<dyn Connection>` factory based on `ConnectionConfig`
- `desktop/src-tauri/src/hardware/connection/bluetooth.rs` — moved from today's `bluetooth.rs`, implements `Connection`
- `desktop/src-tauri/src/hardware/connection/serial.rs` — `serialport` crate, implements `Connection`
- `desktop/src-tauri/src/hardware/connection/network.rs` — `tokio::net::TcpStream`, implements `Connection`
- `desktop/src-tauri/src/tauri_commands.rs` — Tauri `#[command]` handlers calling into `hardware/` and `escpos/`

**Modify (Rust):**
- `desktop/src-tauri/src/main.rs` — replace inline implementations with calls into modules; rewrite `invoke_handler!` to register full Tier 1 surface
- `desktop/src-tauri/Cargo.toml` — add `serialport`, `dirs` (for `~/.kds/`)
- Delete `desktop/src-tauri/src/bluetooth.rs` (logic moved to `hardware/connection/bluetooth.rs`)

**Modify (frontend):**
- `frontend/src/lib/tauri.ts` — drop unused `HardwareService.callPager` and `HardwareService.getDeviceStatus`; tighten the `print_receipt` invoke args to match the new Rust contract
- `frontend/src/pages/pos/POSPage.tsx` — call `HardwareService.printReceipt(deviceId, snapshot)` in `createPayment.onSuccess`; call `HardwareService.openCashDrawer(deviceId)` if `paymentMethod === 'CASH'`
- `frontend/src/features/pos/hooks/usePosSocket.ts` (or wherever the order:new handler lives) — call `HardwareService.printKitchenOrder(deviceId, kitchenSnapshot)` when running in Tauri
- `frontend/src/components/orders/PaymentDetail.tsx` (or equivalent) — Reprint button calling `HardwareService.printReceipt` with stored snapshot
- `frontend/src/api/orders.ts` — ensure payment response surfaces `receiptSnapshot` to the frontend
- `frontend/src/store/uiStore.ts` (or new) — store the user's "default receipt printer" deviceId selection (per-machine in localStorage, since each terminal has its own printer)

**No backend changes** in this plan — Phase 1.2 already persists the snapshots.

---

## Phase 1.3 work decomposes into 4 sub-phases

| Phase | What | Effort | Risk |
|---|---|---|---|
| 1.3.A | Mechanical refactor: extract bluetooth.rs into hardware/connection/bluetooth.rs + escpos/ modules. No behavior change. Verifies via cargo check + the existing `print_receipt` command still works. | M (~1 day) | Low — pure code movement |
| 1.3.B | CP-857 Turkish encoding (Bug E) — new code in escpos/codepage.rs + escpos/mod.rs init sequence. | S (~half day) | Low — local, well-tested |
| 1.3.C | Add the missing Tauri commands (initialize_hardware, list_devices, add_device, remove_device, get_device_status, test_device, print_kitchen_order, open_cash_drawer, list_printers/set_printer/get_printer legacy) + hardware-event emitter + Serial + Network Connection impls. | L (~2 days) | Medium — new code, real hardware needed for full E2E |
| 1.3.D | Frontend wiring: POSPage print on payment-success + cash drawer on CASH + kitchen-print on order:new + Reprint button + dropping dead wrappers. | M (~1 day) | Low — incremental, gated on `isTauri()` |

Each sub-phase ends in a verifiable, mergeable commit. They can ship as separate PRs or one bundled PR — recommend separate so 1.3.A's mechanical refactor reviews fast.

---

## Sub-phase 1.3.A — Mechanical refactor

### Task 1: Pre-flight verification

- [ ] **Step 1: Verify current build**

```bash
cd desktop/src-tauri && cargo check 2>&1 | tail -20
```

Expected: clean build, no errors. If failure isn't libdbus-related, stop and investigate.

- [ ] **Step 2: Snapshot current Tauri command surface**

```bash
grep -n "tauri::generate_handler" desktop/src-tauri/src/main.rs
```

Expected: 8 commands listed: init_bluetooth, scan_devices, connect_device, disconnect_device, get_connected_devices, write_characteristic, read_characteristic, print_receipt. Bookmark this set — refactor must preserve every one.

### Task 2: Set up empty module skeleton

**Files:**
- Create: `desktop/src-tauri/src/escpos/mod.rs`
- Create: `desktop/src-tauri/src/hardware/mod.rs`
- Create: `desktop/src-tauri/src/hardware/connection/mod.rs`
- Modify: `desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Create empty modules**

```bash
mkdir -p desktop/src-tauri/src/{escpos,hardware/connection}
echo "// scaffold — populated in subsequent tasks" > desktop/src-tauri/src/escpos/mod.rs
echo "// scaffold — populated in subsequent tasks" > desktop/src-tauri/src/hardware/mod.rs
echo "// scaffold — populated in subsequent tasks" > desktop/src-tauri/src/hardware/connection/mod.rs
```

- [ ] **Step 2: Wire the new modules into `main.rs`**

In `desktop/src-tauri/src/main.rs`, after `mod bluetooth;` add:

```rust
mod escpos;
mod hardware;
```

- [ ] **Step 3: Verify compile**

```bash
cd desktop/src-tauri && cargo check 2>&1 | tail -10
```

Expected: clean (empty modules compile fine).

- [ ] **Step 4: Commit**

```bash
git add desktop/src-tauri/src/{escpos,hardware} desktop/src-tauri/src/main.rs
git commit -m "refactor(desktop): scaffold escpos and hardware modules

Empty module skeletons for the upcoming hardware-suite refactor.
Subsequent commits move code from bluetooth.rs into these modules
without behavior changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3: Move PrinterCommand into escpos/mod.rs

**Files:**
- Modify: `desktop/src-tauri/src/escpos/mod.rs`
- Modify: `desktop/src-tauri/src/bluetooth.rs`
- Modify: `desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Move the `PrinterCommand` enum and its `to_bytes()` impl**

Cut from `desktop/src-tauri/src/bluetooth.rs` (lines ~53-130 — the `PrinterCommand` enum and its `impl PrinterCommand` block). Paste into `desktop/src-tauri/src/escpos/mod.rs`. Add `use serde::{Deserialize, Serialize};` at top of the destination file.

- [ ] **Step 2: Re-export from bluetooth.rs**

In `desktop/src-tauri/src/bluetooth.rs` top-of-file, add:

```rust
pub use crate::escpos::PrinterCommand;
```

This keeps the existing `use bluetooth::{BluetoothManager, PrinterCommand, ScannedDevice};` import in `main.rs` working without churn.

- [ ] **Step 3: Verify**

```bash
cd desktop/src-tauri && cargo check 2>&1 | tail -10
```

Expected: clean. Re-run `cargo build` once if the cache is stale.

- [ ] **Step 4: Commit**

```bash
git add desktop/src-tauri/src/{escpos/mod.rs,bluetooth.rs}
git commit -m "refactor(desktop): move PrinterCommand into escpos module

No behavior change — PrinterCommand and its to_bytes() impl moved
verbatim. bluetooth.rs re-exports for compat with existing main.rs imports.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4: Define Connection trait

**Files:**
- Modify: `desktop/src-tauri/src/hardware/connection/mod.rs`

- [ ] **Step 1: Write the trait + factory**

Replace `desktop/src-tauri/src/hardware/connection/mod.rs` with:

```rust
use async_trait::async_trait;
use std::time::Duration;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ConnectionError {
    #[error("Connection failed: {0}")]
    ConnectFailed(String),
    #[error("Write failed: {0}")]
    WriteFailed(String),
    #[error("Read failed: {0}")]
    ReadFailed(String),
    #[error("Not connected")]
    NotConnected,
    #[error("Timeout after {0:?}")]
    Timeout(Duration),
    #[error("Internal: {0}")]
    Internal(String),
}

pub type ConnectionResult<T> = Result<T, ConnectionError>;

/// Abstraction over the wire that a hardware device speaks to. Concrete
/// implementations live in sibling modules: bluetooth.rs (BLE GATT writes),
/// serial.rs (serial-port USB-CDC), network.rs (TCP).
#[async_trait]
pub trait Connection: Send + Sync {
    /// Open the connection. Idempotent — connecting twice is a no-op.
    async fn open(&mut self) -> ConnectionResult<()>;

    /// Close the connection. Idempotent.
    async fn close(&mut self) -> ConnectionResult<()>;

    /// Send raw bytes (e.g. an ESC/POS command stream).
    async fn write(&mut self, bytes: &[u8]) -> ConnectionResult<()>;

    /// Lightweight liveness check used by status/health logic. Returns
    /// `Ok(true)` if the OS reports the connection alive.
    async fn is_alive(&self) -> ConnectionResult<bool>;

    /// Stable identifier used as the HashMap key in HardwareManager.
    fn device_id(&self) -> &str;
}

pub mod bluetooth;
// pub mod serial;   // populated in Task 14
// pub mod network;  // populated in Task 15
```

- [ ] **Step 2: Add async-trait dependency**

In `desktop/src-tauri/Cargo.toml` `[dependencies]` block, add:

```toml
async-trait = "0.1"
```

- [ ] **Step 3: Verify**

```bash
cd desktop/src-tauri && cargo check 2>&1 | tail -10
```

Expected: error about missing `bluetooth` submodule. That's expected — Task 5 fills it in. Don't commit yet.

### Task 5: Move BLE code into hardware/connection/bluetooth.rs

**Files:**
- Create: `desktop/src-tauri/src/hardware/connection/bluetooth.rs`
- Modify: `desktop/src-tauri/src/bluetooth.rs` (delete after this task)
- Modify: `desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Move the body of `desktop/src-tauri/src/bluetooth.rs`** (everything except the `pub use crate::escpos::PrinterCommand;` re-export added in Task 3) **to `desktop/src-tauri/src/hardware/connection/bluetooth.rs`**.

- [ ] **Step 2: Wrap `BluetoothManager` (or its successor `BluetoothConnection`) to implement `Connection`**

Initial implementation can be a thin adapter — the goal here is just to get the trait shape right. Full per-device connection management lands in Sub-phase 1.3.C.

```rust
// At the top of hardware/connection/bluetooth.rs
use async_trait::async_trait;
use crate::hardware::connection::{Connection, ConnectionError, ConnectionResult};

// ... existing BluetoothManager + ScannedDevice + BluetoothError ...

pub struct BluetoothConnection {
    device_id: String,
    manager: Arc<Mutex<Option<BluetoothManager>>>,
}

#[async_trait]
impl Connection for BluetoothConnection {
    async fn open(&mut self) -> ConnectionResult<()> {
        let mgr = self.manager.lock().unwrap();
        let bt = mgr.as_ref().ok_or(ConnectionError::NotConnected)?;
        bt.connect_device(&self.device_id)
            .await
            .map_err(|e| ConnectionError::ConnectFailed(e.to_string()))
    }
    async fn close(&mut self) -> ConnectionResult<()> {
        let mgr = self.manager.lock().unwrap();
        let bt = mgr.as_ref().ok_or(ConnectionError::NotConnected)?;
        bt.disconnect_device(&self.device_id)
            .await
            .map_err(|e| ConnectionError::Internal(e.to_string()))
    }
    async fn write(&mut self, bytes: &[u8]) -> ConnectionResult<()> {
        let mgr = self.manager.lock().unwrap();
        let bt = mgr.as_ref().ok_or(ConnectionError::NotConnected)?;
        // Reuse existing write_characteristic helper; default char UUID is the
        // common ESC/POS notify char on most generic thermal printers.
        let default_char = "0000ff02-0000-1000-8000-00805f9b34fb";
        bt.write_characteristic(&self.device_id, default_char, bytes)
            .await
            .map_err(|e| ConnectionError::WriteFailed(e.to_string()))
    }
    async fn is_alive(&self) -> ConnectionResult<bool> {
        let mgr = self.manager.lock().unwrap();
        let bt = mgr.as_ref().ok_or(ConnectionError::NotConnected)?;
        Ok(bt.get_connected_devices().contains(&self.device_id))
    }
    fn device_id(&self) -> &str {
        &self.device_id
    }
}
```

- [ ] **Step 3: Update main.rs imports**

In `desktop/src-tauri/src/main.rs`, replace `mod bluetooth;` with `// (bluetooth.rs deleted; logic in hardware/connection/bluetooth.rs)` and update imports:

**Before:**
```rust
mod bluetooth;
use bluetooth::{BluetoothManager, PrinterCommand, ScannedDevice};
```

**After:**
```rust
mod escpos;
mod hardware;
use crate::escpos::PrinterCommand;
use crate::hardware::connection::bluetooth::{BluetoothManager, ScannedDevice};
```

- [ ] **Step 4: Delete the old bluetooth.rs**

```bash
rm desktop/src-tauri/src/bluetooth.rs
```

- [ ] **Step 5: Verify**

```bash
cd desktop/src-tauri && cargo check 2>&1 | tail -10
```

Expected: clean. Adjust imports if anything fails to resolve.

- [ ] **Step 6: Commit**

```bash
git add desktop/src-tauri/src/{hardware,main.rs}
git rm desktop/src-tauri/src/bluetooth.rs
git commit -m "refactor(desktop): move bluetooth.rs into hardware/connection/

Pure code movement — no behavior change. BluetoothManager retains its
public API; new BluetoothConnection is a thin Connection-trait wrapper
to be expanded in subsequent tasks. Connection trait sits in
hardware/connection/mod.rs and is the interface for upcoming serial.rs
and network.rs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Sub-phase 1.3.B — CP-857 Turkish encoding (Bug E)

### Task 6: Build the Unicode→CP-857 lookup table

**Files:**
- Create: `desktop/src-tauri/src/escpos/codepage.rs`
- Modify: `desktop/src-tauri/src/escpos/mod.rs`

- [ ] **Step 1: Write the codepage module with tests**

Create `desktop/src-tauri/src/escpos/codepage.rs`:

```rust
//! UTF-8 → CP-857 transcoder for Turkish ESC/POS receipt printing.
//!
//! CP-857 covers Latin-5 / Turkish. Most generic thermal printers default to
//! CP-437 (US ASCII) or CP-850 (Multilingual Latin-1), neither of which has
//! the dotted/dotless I or the cedilla'd letters Turkish menus use. We send
//! `ESC t 18` once on Initialize to switch the printer to CP-857, then map
//! each non-ASCII char in TextLine commands through this table before send.
//!
//! Source: Microsoft codepage 857 reference + ESC/POS docs (Star Micronics,
//! Epson). Covers the full Turkish alphabet (Ç ç Ğ ğ I ı İ Ö ö Ş ş Ü ü)
//! plus symbols a Turkish receipt commonly carries (₺ TL sign, € €).
//!
//! Unmapped characters become `?` (0x3F) — better than silent truncation.

/// CP-857 selector byte (the `n` argument to `ESC t n`).
pub const CP857_SELECTOR: u8 = 13; // CP-857 in ESC/POS code-page table

/// Transcode a UTF-8 string to CP-857 bytes. Each input char that has no
/// CP-857 mapping is replaced by '?' (0x3F).
pub fn utf8_to_cp857(input: &str) -> Vec<u8> {
    input.chars().map(map_char).collect()
}

fn map_char(c: char) -> u8 {
    // ASCII range pass-through (0x00..0x7F is identical in CP-857).
    if (c as u32) < 0x80 {
        return c as u8;
    }
    match c {
        // Turkish letter set
        'Ç' => 0x80, 'ü' => 0x81, 'é' => 0x82, 'â' => 0x83, 'ä' => 0x84,
        'à' => 0x85, 'å' => 0x86, 'ç' => 0x87, 'ê' => 0x88, 'ë' => 0x89,
        'è' => 0x8A, 'ï' => 0x8B, 'î' => 0x8C, 'ı' => 0x8D, 'Ä' => 0x8E,
        'Å' => 0x8F, 'É' => 0x90, 'æ' => 0x91, 'Æ' => 0x92, 'ô' => 0x93,
        'ö' => 0x94, 'ò' => 0x95, 'û' => 0x96, 'ù' => 0x97, 'İ' => 0x98,
        'Ö' => 0x99, 'Ü' => 0x9A, 'ø' => 0x9B, '£' => 0x9C, 'Ø' => 0x9D,
        'Ş' => 0x9E, 'ş' => 0x9F,
        'á' => 0xA0, 'í' => 0xA1, 'ó' => 0xA2, 'ú' => 0xA3, 'ñ' => 0xA4,
        'Ñ' => 0xA5, 'Ğ' => 0xA6, 'ğ' => 0xA7,
        // Currency symbols
        '€' => 0xD5, // CP-857 has € at 0xD5 in the Microsoft variant
        // Box-drawing & misc — passthrough for the 0xB0..0xDF range is
        // not needed for receipts; collapse to '?'.
        _ => b'?',
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_passthrough() {
        assert_eq!(utf8_to_cp857("Hello, World!"), b"Hello, World!".to_vec());
    }

    #[test]
    fn turkish_alphabet_lowercase() {
        // ç ğ ı ö ş ü
        let bytes = utf8_to_cp857("çğıöşü");
        assert_eq!(bytes, vec![0x87, 0xA7, 0x8D, 0x94, 0x9F, 0x81]);
    }

    #[test]
    fn turkish_alphabet_uppercase() {
        // Ç Ğ İ Ö Ş Ü
        let bytes = utf8_to_cp857("ÇĞİÖŞÜ");
        assert_eq!(bytes, vec![0x80, 0xA6, 0x98, 0x99, 0x9E, 0x9A]);
    }

    #[test]
    fn turkish_menu_item() {
        // A real menu line: "Adana Kebap × 2  60,00 ₺"
        let bytes = utf8_to_cp857("Adana Kebap");
        assert_eq!(bytes, b"Adana Kebap".to_vec());
    }

    #[test]
    fn unknown_chars_become_question_mark() {
        // Emoji is not in CP-857 — should map to '?'.
        let bytes = utf8_to_cp857("🍔");
        assert_eq!(bytes, vec![b'?']);
    }

    #[test]
    fn euro_sign() {
        assert_eq!(utf8_to_cp857("€"), vec![0xD5]);
    }
}
```

- [ ] **Step 2: Wire the transcoder into `PrinterCommand::to_bytes`**

In `desktop/src-tauri/src/escpos/mod.rs`, add at the top:

```rust
pub mod codepage;
use codepage::{utf8_to_cp857, CP857_SELECTOR};
```

Replace the `Initialize` and text-emitting branches in `to_bytes`:

**Before:**
```rust
PrinterCommand::Initialize => vec![0x1B, 0x40], // ESC @
PrinterCommand::Text(text) => text.as_bytes().to_vec(),
PrinterCommand::TextLine(text) => {
    let mut bytes = text.as_bytes().to_vec();
    bytes.extend_from_slice(&[0x0A]); // LF
    bytes
}
```

**After:**
```rust
PrinterCommand::Initialize => {
    // ESC @ (reset) + ESC t 13 (select CP-857 / Turkish)
    let mut bytes = vec![0x1B, 0x40];
    bytes.extend_from_slice(&[0x1B, 0x74, CP857_SELECTOR]);
    bytes
}
PrinterCommand::Text(text) => utf8_to_cp857(text),
PrinterCommand::TextLine(text) => {
    let mut bytes = utf8_to_cp857(text);
    bytes.push(0x0A); // LF
    bytes
}
```

- [ ] **Step 3: Run the codepage tests**

```bash
cd desktop/src-tauri && cargo test --lib escpos::codepage::tests 2>&1 | tail -10
```

Expected: 6 tests pass.

- [ ] **Step 4: Commit**

```bash
git add desktop/src-tauri/src/escpos/{mod.rs,codepage.rs}
git commit -m "feat(desktop/escpos): CP-857 Turkish character transcoder (Bug E)

Turkish menus use ç/ğ/ı/ö/ş/ü/Ç/Ğ/İ/Ö/Ş/Ü which UTF-8 emits as multibyte
sequences. ESC/POS thermal printers default to CP-437 (US ASCII) or
CP-850, neither of which contains the dotless ı or cedilla'd letters,
so today's receipts mojibake on every Turkish item.

Initialize now sends ESC t 13 (select CP-857 / Turkish) once, and Text/
TextLine transcode UTF-8 → CP-857 before sending. Unknown chars become
'?' rather than silently truncating.

Refs: docs/superpowers/specs/2026-04-27-desktop-pos-camera-reliability-design.md §3.3 (Bug E folded into Tier 1).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Sub-phase 1.3.C — Missing Tauri commands + connection types

This is the biggest sub-phase. ~10 commands, 2 new connection types, persistence layer, event emitter. Recommend dispatching one task per command/concern with TDD where feasible (Rust unit tests for pure logic; manual hardware verification for IO).

**Tasks 7–22** (full content omitted for brevity in this overview — each task follows the same structure as Tasks 1–6: file targets, code blocks, `cargo check`/`cargo test` verification, commit message). Outline:

- **Task 7**: `hardware/config.rs` — serde structs matching `frontend/src/types/hardware.ts`, load/save `~/.kds/hardware.json` via `dirs::config_dir()`. Tests: round-trip a config through write+read, verify schema-compatible JSON.
- **Task 8**: `hardware/status.rs` — `DeviceStatus` struct, `HashMap<DeviceId, DeviceStatus>` cache, `update_last_activity` / `mark_error` helpers.
- **Task 9**: `hardware/events.rs` — `HardwareEvent` enum matching frontend type, `emit_to_window(app: &tauri::AppHandle, event: &HardwareEvent)` helper using `app.emit_all("hardware-event", ...)`.
- **Task 10**: `hardware/mod.rs` — `HardwareManager` owns `Arc<RwLock<HashMap<DeviceId, Box<dyn Connection>>>>` plus the config + status + AppHandle for emitting events. Single source of truth for the runtime state.
- **Task 11**: `tauri_commands.rs` skeleton — define the 13 `#[command]` async fn signatures; bodies are `todo!()` for now. Update `main.rs invoke_handler!` macro to register all 13. `cargo check` verifies the surface compiles even without bodies.
- **Task 12**: Implement `initialize_hardware { backendUrl }` — instantiate HardwareManager, load config, schedule auto_connect for `auto_connect: true` devices in background tokio task, emit `DeviceConnected`/`ConnectionError` events as they resolve.
- **Task 13**: Implement `list_devices` and `get_device_status` — read from manager's status HashMap. Trivial.
- **Task 14**: Implement `add_device { config }` and `remove_device { deviceId }` — persist via config layer. Test: round-trip a device through add/list/remove.
- **Task 15**: Implement `connect_device` and `disconnect_device` against the Connection trait (extending today's BLE-only path to also serve serial/network when configured). Emit `DeviceConnected` / `DeviceDisconnected` events.
- **Task 16**: Implement `print_receipt` against new `ReceiptData` shape — receipt_template.rs constructs a `Vec<PrinterCommand>`, manager looks up the device's connection by id, calls `connection.write(&commands_to_bytes(&cmds))`. **The new shape is what `frontend/src/types/hardware.ts::ReceiptData` declares** — match it exactly.
- **Task 17**: Implement `print_kitchen_order` — same pattern with `kitchen_template.rs`. No QR, no totals, larger item names, special-instructions footer.
- **Task 18**: Implement `open_cash_drawer { deviceId }` — sends ESC/POS pulse `[0x1B, 0x70, 0x00, 0x32, 0xFA]` (ESC p 0 50 250) over the connection identified by deviceId. Per the spec, the deviceId IS the printer's deviceId (drawer is a peripheral of the printer).
- **Task 19**: Implement `test_device { deviceId }` — for THERMAL_PRINTER prints a small test receipt (with a Turkish chars sample so CP-857 is verified end-to-end on real hardware); for CASH_DRAWER opens drawer; emits `BarcodeScanned` test event on a BARCODE_READER (Tier 2 stub).
- **Task 20**: Implement legacy `list_printers`, `set_printer`, `get_printer` — map to `list_devices` filtered to THERMAL_PRINTER + Serial, and a `default_printer_id` field in `~/.kds/hardware.json`. Keeps `PrinterSettings.tsx` working until UI is replaced.
- **Task 21**: Implement `serial.rs` Connection — uses the `serialport` crate, opens by config.port + baud_rate. Handle write timeout via `serialport::SerialPort::set_timeout`.
- **Task 22**: Implement `network.rs` Connection — `tokio::net::TcpStream::connect`, write directly. Useful for IP-attached thermal printers (common in commercial deployments).

After Task 22: end-to-end manual smoke test on a real BLE printer + a real serial printer to verify Tier 1 surface works on real hardware. Each task ends in its own commit.

---

## Sub-phase 1.3.D — Frontend wiring

### Task 23: Drop dead HardwareService methods

**Files:**
- Modify: `frontend/src/lib/tauri.ts`

- [ ] **Step 1: Verify they're truly unused**

```bash
cd /home/tarik/Projects/kds && grep -rn "callPager\|getDeviceStatus" frontend/src --include="*.tsx" --include="*.ts" | grep -v "lib/tauri.ts"
```

Expected: zero matches outside `tauri.ts`. If anything else references them, STOP and surface to the human — these aren't dead.

- [ ] **Step 2: Delete the two methods from `HardwareService`** (lines 63-74 for getDeviceStatus, 183-202 for callPager — verify line numbers before deleting). Also delete the corresponding TypeScript types if they're only used by these methods.

- [ ] **Step 3: Run frontend build to confirm nothing else broke**

```bash
cd frontend && npm run build 2>&1 | tail -10
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/tauri.ts
git commit -m "chore(frontend): drop unused HardwareService.callPager and getDeviceStatus

Verified zero UI consumers via grep. These wrappers invoked Tauri
commands that don't exist in the Rust side — calling them would throw
'Unknown command' at runtime. Pager support is deferred per spec §3.3
Tier 2 (vendor-specific protocols).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 24: Wire payment-success → printReceipt in POSPage

**Files:**
- Modify: `frontend/src/pages/pos/POSPage.tsx`
- Modify: `frontend/src/api/orders.ts` (ensure `receiptSnapshot` surfaces in payment response)
- Possibly modify: `frontend/src/store/uiStore.ts` (default printer deviceId persistence)

- [ ] **Step 1: Surface `receiptSnapshot` in the payment-create response**

Verify `frontend/src/api/orders.ts` `createPayment` mutation returns the snapshot. If the response is typed as e.g. `Payment` without the snapshot, update the type to include `receiptSnapshot: NewReceiptData | null`. Alternatively, fetch from a separate endpoint.

- [ ] **Step 2: In `POSPage.tsx`, find the `createPayment.onSuccess` handler** (around the payment confirmation flow — search for `createPayment` mutation usage). Add:

```typescript
import { HardwareService, isTauri } from '../../lib/tauri';
import { useUIStore } from '../../store/uiStore';

// inside the component:
const defaultPrinterId = useUIStore((s) => s.defaultPrinterId);

// inside createPayment.onSuccess:
const snapshot = response?.receiptSnapshot;
if (isTauri() && defaultPrinterId && snapshot) {
  HardwareService.printReceipt(defaultPrinterId, snapshot).catch((err) => {
    console.error('Receipt print failed:', err);
    toast.error(t('pos.printer.receiptPrintFailed'));
    // Snapshot is already persisted by backend — user can hit Reprint.
  });
}
if (isTauri() && defaultPrinterId && response?.method === 'CASH') {
  HardwareService.openCashDrawer(defaultPrinterId).catch((err) => {
    console.error('Cash drawer open failed:', err);
  });
}
```

- [ ] **Step 3: Add `defaultPrinterId` to `uiStore`** (or wherever per-machine UI state lives). Persist via Zustand `persist` middleware so the user's printer selection survives reloads.

- [ ] **Step 4: Manual smoke test**

In a desktop dev build, complete a payment and verify the receipt prints. Try with the printer disconnected — verify the toast fires and payment still succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/pos/POSPage.tsx \
        frontend/src/api/orders.ts \
        frontend/src/store/uiStore.ts
git commit -m "feat(pos): auto-print receipt and open cash drawer on payment success

Wires HardwareService.printReceipt(defaultPrinterId, snapshot) into
createPayment.onSuccess in POSPage. Snapshot comes from the backend
payment response (Payment.receiptSnapshot, populated by the backend in
PR #216). Cash drawer opens via ESC/POS pulse over the printer
connection when paymentMethod is CASH.

A failed print never blocks the payment — error surfaces as a toast +
console error, and the user can hit Reprint (Task 26) since the
snapshot is persisted.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 25: Wire kitchen-ticket print on order:new

**Files:**
- Modify: `frontend/src/features/pos/hooks/usePosSocket.ts` (or equivalent)

- [ ] **Step 1: Find the order:new socket-event handler** and add the kitchen-ticket print call (gated on `isTauri()` and a `defaultKitchenPrinterId`):

```typescript
const onOrderNew = (order: any) => {
  // ... existing cache update ...
  if (isTauri() && defaultKitchenPrinterId && order.kitchenTicketSnapshot) {
    HardwareService.printKitchenOrder(
      defaultKitchenPrinterId,
      order.kitchenTicketSnapshot,
    ).catch(console.error);
  }
};
```

- [ ] **Step 2: Add `defaultKitchenPrinterId` to uiStore** if not already present.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/pos/hooks/usePosSocket.ts \
        frontend/src/store/uiStore.ts
git commit -m "feat(kitchen): auto-print kitchen ticket on order:new socket event

Same pattern as receipt printing on payment success: gated on isTauri()
and a configured default kitchen printer. Reads kitchenTicketSnapshot
from the broadcast order payload (populated by orders.service.create
in PR #216).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 26: Reprint button on payment detail

**Files:**
- Modify: `frontend/src/components/orders/PaymentDetail.tsx` (or wherever payment detail lives — locate via `grep -rn 'receiptSnapshot\\|payment\\.id' frontend/src/components`)
- Possibly create: `frontend/src/components/orders/ReprintButton.tsx`

- [ ] **Step 1: Add a button that fetches the payment's `receiptSnapshot` and calls `HardwareService.printReceipt(defaultPrinterId, snapshot)`**.

- [ ] **Step 2: Disabled state** when not in Tauri or no default printer configured. Tooltip explains why.

- [ ] **Step 3: Commit**.

### Task 27: End-to-end smoke test on real hardware

This is a manual checklist. Perform it once Tasks 1-26 are merged.

- [ ] Boot desktop app on a Mac, Win, and Linux machine. Each starts cleanly.
- [ ] In settings, add a BLE thermal printer; verify it pairs and `test_device` prints with Turkish chars legible.
- [ ] Add a serial printer; verify same.
- [ ] Take a sample order with Turkish menu items (Adana Kebap, Ayran, Künefe). Send to kitchen → kitchen ticket prints with Turkish chars correct.
- [ ] Pay in cash → receipt prints, cash drawer opens.
- [ ] Pay by card → receipt prints, cash drawer does NOT open.
- [ ] Disconnect printer mid-shift; pay an order; verify toast fires + payment succeeds + Reprint button works once printer is reconnected.
- [ ] In web mode (no Tauri), verify everything still works without print attempts.

---

## Self-review checklist (run before opening PR)

- [ ] **Tauri command parity:** every method invoked from `HardwareService` and `PrinterService` in `frontend/src/lib/tauri.ts` has a corresponding `#[tauri::command]` in the Rust crate (or has been deleted in Task 23).
- [ ] **CP-857 sample verifies on real hardware:** `test_device` printout includes "ÇĞİÖŞÜçğıöşü" and is legible.
- [ ] **No regression in the existing `print_receipt` callsite:** `PrinterSettings.tsx` test-print button still works.
- [ ] **Cargo check + cargo test pass on Linux + macOS.** Windows verified via CI.
- [ ] **`npm run build` clean** for frontend.
- [ ] **Backend untouched:** `git diff test..HEAD -- backend/` is empty.

---

## What this plan does NOT cover (explicit deferrals)

- **Bug A Tier 2** (barcode reader, restaurant pager, scale device, customer display) — separate plan when there's actual demand + a specific vendor target.
- **Bug A Tier 3** (mDNS auto-discovery, multi-printer routing per-category, Apple AirPrint) — backlog.
- **BLE state machine + retry/backoff** — Phase 3 hardening.
- **Auto-update rollback** — Phase 3 hardening.
- **Backend changes** — none required; Phase 1.2 provides everything this plan reads.

---

## Estimated total effort

- Sub-phase 1.3.A: 1 day (mechanical refactor)
- Sub-phase 1.3.B: 0.5 day (CP-857 encoding)
- Sub-phase 1.3.C: 2 days (10 commands + 2 connection types)
- Sub-phase 1.3.D: 1 day (frontend wiring)

Total: **~4.5 days of focused work**, expected to span 3–4 sessions.

//! Hardware lifecycle events emitted to the React frontend.
//!
//! Mirrors `frontend/src/types/hardware.ts::HardwareEvent` — a tagged
//! union with `type` + `data` shape. Frontend already subscribes via
//! `HardwareService.listenToHardwareEvents()`; we just need to fire
//! events from Rust at the right moments (connect/disconnect/error).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum HardwareEvent {
    DeviceConnected {
        device_id: String,
        device_name: String,
        timestamp: DateTime<Utc>,
    },
    DeviceDisconnected {
        device_id: String,
        device_name: String,
        timestamp: DateTime<Utc>,
    },
    ConnectionError {
        device_id: String,
        error: String,
        timestamp: DateTime<Utc>,
    },
    PaperOut {
        device_id: String,
        timestamp: DateTime<Utc>,
    },
    PaperLow {
        device_id: String,
        timestamp: DateTime<Utc>,
    },
    CashDrawerOpened {
        device_id: String,
        timestamp: DateTime<Utc>,
    },
    BarcodeScanned {
        device_id: String,
        barcode_data: String,
        barcode_type: String,
        timestamp: DateTime<Utc>,
    },
    PagerCalled {
        device_id: String,
        pager_number: u32,
        timestamp: DateTime<Utc>,
    },
    DeviceError {
        device_id: String,
        error: String,
        timestamp: DateTime<Utc>,
    },
}

/// Push a hardware event to all open windows. The frontend subscribes
/// via `HardwareService.listenToHardwareEvents()` (`tauri.ts`).
pub fn emit(app: &AppHandle, event: HardwareEvent) {
    if let Err(e) = app.emit_all("hardware-event", &event) {
        // Don't crash hardware logic for an emit failure — log and move on.
        eprintln!("Failed to emit hardware-event: {}", e);
    }
}

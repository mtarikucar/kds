//! Hardware management (printer, cash drawer, future barcode/scale/pager).
//!
//! Today's primary surface:
//!   - `config` — `~/.kds/hardware.json` persistence + serde structs that
//!     mirror `frontend/src/types/hardware.ts`
//!   - `status` — runtime DeviceStatus tracking exposed via list_devices /
//!     get_device_status Tauri commands
//!   - `events` — emit hardware lifecycle events (DeviceConnected,
//!     ConnectionError, etc.) to the React frontend via Tauri's event bus
//!
//! All connection logic still goes through BluetoothManager today (see
//! crate::bluetooth). The `connection` submodule is scaffolded for the
//! future Connection-trait abstraction that lets us slot in Serial /
//! Network / USB-HID alongside BLE.

pub mod config;
pub mod connection;
pub mod events;
pub mod status;

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use config::{DeviceConfig, HardwareConfig};
use status::DeviceStatus;

/// Central runtime state for the hardware suite. Wraps the persisted
/// `HardwareConfig` plus an in-memory `DeviceStatus` cache keyed by
/// device id. Behind an `Arc<RwLock<...>>` so Tauri command handlers
/// can read concurrently and writers are exclusive.
#[derive(Debug, Default)]
pub struct HardwareManagerInner {
    pub config: HardwareConfig,
    pub statuses: HashMap<String, DeviceStatus>,
}

pub type HardwareManager = Arc<RwLock<HardwareManagerInner>>;

/// Build a fresh manager and load the persisted config. Each device row
/// gets a default `Disconnected/Unknown` status; the connect flow flips
/// it. Missing/unreadable config = empty default (fresh install).
pub async fn init_manager() -> HardwareManager {
    let config = config::load().unwrap_or_else(|err| {
        eprintln!(
            "[hardware] could not load ~/.kds/hardware.json ({}); starting empty",
            err
        );
        HardwareConfig::default()
    });

    let mut statuses = HashMap::new();
    for dev in &config.devices {
        statuses.insert(dev.id.clone(), DeviceStatus::from_config(dev));
    }

    Arc::new(RwLock::new(HardwareManagerInner { config, statuses }))
}

/// Add or replace a device row, persist the config, and ensure its status
/// row exists. Used by the `add_device` Tauri command.
pub async fn upsert_device(
    manager: &HardwareManager,
    device: DeviceConfig,
) -> Result<DeviceConfig, String> {
    let mut guard = manager.write().await;

    // Replace if id already present, else append.
    let pos = guard.config.devices.iter().position(|d| d.id == device.id);
    match pos {
        Some(i) => guard.config.devices[i] = device.clone(),
        None => guard.config.devices.push(device.clone()),
    }
    guard
        .statuses
        .entry(device.id.clone())
        .or_insert_with(|| DeviceStatus::from_config(&device));

    config::save(&guard.config).map_err(|e| e.to_string())?;
    Ok(device)
}

/// Drop a device row + its status. Used by the `remove_device` Tauri command.
pub async fn remove_device(
    manager: &HardwareManager,
    device_id: &str,
) -> Result<(), String> {
    let mut guard = manager.write().await;
    guard.config.devices.retain(|d| d.id != device_id);
    guard.statuses.remove(device_id);
    config::save(&guard.config).map_err(|e| e.to_string())
}

/// Snapshot every device's status. Sorted by name for stable UI ordering.
pub async fn list_statuses(manager: &HardwareManager) -> Vec<DeviceStatus> {
    let guard = manager.read().await;
    let mut out: Vec<DeviceStatus> = guard.statuses.values().cloned().collect();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

pub async fn get_status(
    manager: &HardwareManager,
    device_id: &str,
) -> Option<DeviceStatus> {
    manager.read().await.statuses.get(device_id).cloned()
}

//! Per-machine hardware configuration persisted at `~/.kds/hardware.json`.
//!
//! Hardware setup is per-terminal — each restaurant's POS station has its own
//! paired printer / drawer / kitchen printer / barcode reader. We do NOT
//! sync this to the backend tenant settings: a tenant with two terminals
//! means two `hardware.json` files, one per machine, and that's correct.
//!
//! The shape mirrors `frontend/src/types/hardware.ts` so the JSON round-trips
//! between Rust and the React UI without translation.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ConfigError {
    #[error("Could not locate user config directory")]
    NoConfigDir,
    #[error("Failed to read hardware config at {0}: {1}")]
    ReadFailed(PathBuf, String),
    #[error("Failed to write hardware config at {0}: {1}")]
    WriteFailed(PathBuf, String),
    #[error("Hardware config JSON is invalid: {0}")]
    InvalidJson(String),
}

pub type ConfigResult<T> = Result<T, ConfigError>;

/// Top-level hardware config. Today: a flat list of devices + the user's
/// default-printer pointer for the legacy PrinterService path. Future
/// optional fields (e.g. `default_kitchen_printer`, `default_drawer`) get
/// added as `Option<...>` without bumping the format — JSON is forgiving
/// of extra/missing keys.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HardwareConfig {
    /// All paired devices on this machine.
    #[serde(default)]
    pub devices: Vec<DeviceConfig>,

    /// Legacy PrinterService default-printer port. Kept until
    /// PrinterSettings.tsx is replaced by the new IntegrationsSettingsPage.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_printer_port: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceConfig {
    pub id: String,
    pub name: String,
    pub device_type: DeviceType,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub auto_connect: bool,
    pub connection: ConnectionConfig,
    /// Per-device free-form settings (e.g. paper width, code page override).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<serde_json::Value>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum DeviceType {
    #[serde(rename = "THERMAL_PRINTER")]
    ThermalPrinter,
    #[serde(rename = "CASH_DRAWER")]
    CashDrawer,
    #[serde(rename = "RESTAURANT_PAGER")]
    RestaurantPager,
    #[serde(rename = "BARCODE_READER")]
    BarcodeReader,
    #[serde(rename = "CUSTOMER_DISPLAY")]
    CustomerDisplay,
    #[serde(rename = "KITCHEN_DISPLAY")]
    KitchenDisplay,
    #[serde(rename = "SCALE_DEVICE")]
    ScaleDevice,
}

/// Tagged union matching the frontend's `ConnectionConfig` shape:
/// `{ connection_type: "Bluetooth", config: { device_address, ... } }`.
/// Bluetooth is the only kind wired up today; Serial / Network land when
/// the corresponding Connection-trait impls are added (Phase 1.3.A.3
/// follow-up).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "connection_type", content = "config")]
pub enum ConnectionConfig {
    Bluetooth(BluetoothConnectionConfig),
    Serial(SerialConnectionConfig),
    Network(NetworkConnectionConfig),
    UsbHid(UsbHidConnectionConfig),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BluetoothConnectionConfig {
    pub device_address: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_uuid: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub characteristic_uuid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialConnectionConfig {
    pub port: String,
    pub baud_rate: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConnectionConfig {
    pub ip_address: String,
    pub port: u16,
    #[serde(default = "default_protocol")]
    pub protocol: NetworkProtocol,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u32>,
}

fn default_protocol() -> NetworkProtocol {
    NetworkProtocol::Tcp
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum NetworkProtocol {
    Tcp,
    Udp,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsbHidConnectionConfig {
    pub vendor_id: u16,
    pub product_id: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u32>,
}

/// Resolve the path to `~/.kds/hardware.json`, creating `~/.kds/` if needed.
pub fn config_path() -> ConfigResult<PathBuf> {
    let mut path = dirs::home_dir().ok_or(ConfigError::NoConfigDir)?;
    path.push(".kds");
    if !path.exists() {
        fs::create_dir_all(&path).map_err(|e| {
            ConfigError::WriteFailed(path.clone(), e.to_string())
        })?;
    }
    path.push("hardware.json");
    Ok(path)
}

/// Load the hardware config from disk. Missing file = empty default config
/// (a fresh install on a new terminal). Corrupt file = error so the user
/// sees the problem rather than silently losing their pairings.
pub fn load() -> ConfigResult<HardwareConfig> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(HardwareConfig::default());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| ConfigError::ReadFailed(path.clone(), e.to_string()))?;
    serde_json::from_str(&raw).map_err(|e| ConfigError::InvalidJson(e.to_string()))
}

/// Persist the hardware config to disk atomically: write to a temp file
/// in the same directory, then rename. If the rename succeeds the file
/// is consistent on disk; if it fails the previous file is untouched.
pub fn save(config: &HardwareConfig) -> ConfigResult<()> {
    let path = config_path()?;
    let tmp = path.with_extension("json.tmp");

    let json = serde_json::to_string_pretty(config)
        .map_err(|e| ConfigError::InvalidJson(e.to_string()))?;
    fs::write(&tmp, json)
        .map_err(|e| ConfigError::WriteFailed(tmp.clone(), e.to_string()))?;
    fs::rename(&tmp, &path)
        .map_err(|e| ConfigError::WriteFailed(path.clone(), e.to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_device() -> DeviceConfig {
        DeviceConfig {
            id: "dev-1".to_string(),
            name: "Counter Printer".to_string(),
            device_type: DeviceType::ThermalPrinter,
            enabled: true,
            auto_connect: true,
            connection: ConnectionConfig::Bluetooth(BluetoothConnectionConfig {
                device_address: "AA:BB:CC:DD:EE:FF".to_string(),
                service_uuid: None,
                characteristic_uuid: None,
            }),
            settings: None,
        }
    }

    #[test]
    fn round_trips_through_json() {
        let cfg = HardwareConfig {
            devices: vec![sample_device()],
            default_printer_port: Some("/dev/usb/lp0".to_string()),
        };
        let json = serde_json::to_string(&cfg).unwrap();
        let parsed: HardwareConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.devices.len(), 1);
        assert_eq!(parsed.devices[0].name, "Counter Printer");
        assert_eq!(parsed.devices[0].device_type, DeviceType::ThermalPrinter);
        assert_eq!(parsed.default_printer_port.as_deref(), Some("/dev/usb/lp0"));
    }

    #[test]
    fn connection_config_uses_tagged_union_shape() {
        // Frontend uses { connection_type: "Bluetooth", config: {...} } —
        // confirm the serialized shape matches.
        let conn = ConnectionConfig::Bluetooth(BluetoothConnectionConfig {
            device_address: "AA:BB".to_string(),
            service_uuid: None,
            characteristic_uuid: None,
        });
        let json = serde_json::to_string(&conn).unwrap();
        assert!(json.contains(r#""connection_type":"Bluetooth""#));
        assert!(json.contains(r#""config":{"#));
    }

    #[test]
    fn missing_devices_field_defaults_to_empty() {
        // A hardware.json containing just a default_printer_port should
        // still parse. Tests the #[serde(default)] on devices.
        let json = r#"{ "default_printer_port": "/dev/lp0" }"#;
        let cfg: HardwareConfig = serde_json::from_str(json).unwrap();
        assert!(cfg.devices.is_empty());
        assert_eq!(cfg.default_printer_port.as_deref(), Some("/dev/lp0"));
    }
}

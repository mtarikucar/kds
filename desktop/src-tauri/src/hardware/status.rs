//! Runtime `DeviceStatus` shape returned by `list_devices` /
//! `get_device_status` Tauri commands. Mirrors the frontend's
//! `DeviceStatus` interface in `types/hardware.ts`.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::config::DeviceType;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ConnectionStatus {
    Connected,
    Disconnected,
    Connecting,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum HealthStatus {
    Healthy,
    Warning,
    Error,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct DeviceStatus {
    pub id: String,
    pub name: String,
    pub device_type: DeviceType,
    pub connection_status: ConnectionStatus,
    pub health: HealthStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}

impl DeviceStatus {
    /// Construct a fresh, never-connected status entry from a config row.
    /// New devices start `Disconnected` + `Unknown` health; the connect
    /// flow flips them to `Connected`/`Healthy`.
    pub fn from_config(cfg: &super::config::DeviceConfig) -> Self {
        Self {
            id: cfg.id.clone(),
            name: cfg.name.clone(),
            device_type: cfg.device_type.clone(),
            connection_status: ConnectionStatus::Disconnected,
            health: HealthStatus::Unknown,
            last_activity: None,
            error_message: None,
        }
    }

    pub fn mark_connected(&mut self) {
        // Production path uses the real wall clock. The actual state
        // transition is delegated to `mark_connected_at` so it can be
        // unit-tested with an injected timestamp (no global clock).
        self.mark_connected_at(Utc::now());
    }

    /// Clock-injected variant of [`mark_connected`]. Sets the connected/healthy
    /// state and stamps `last_activity` with the provided instant. Exists so
    /// tests can assert the transition deterministically without depending on
    /// `Utc::now()`; `mark_connected` delegates here with the real clock so
    /// runtime behavior is unchanged.
    pub fn mark_connected_at(&mut self, now: DateTime<Utc>) {
        self.connection_status = ConnectionStatus::Connected;
        self.health = HealthStatus::Healthy;
        self.last_activity = Some(now);
        self.error_message = None;
    }

    pub fn mark_disconnected(&mut self) {
        self.connection_status = ConnectionStatus::Disconnected;
        self.health = HealthStatus::Unknown;
        self.error_message = None;
    }

    pub fn mark_error(&mut self, message: String) {
        self.connection_status = ConnectionStatus::Error;
        self.health = HealthStatus::Error;
        self.error_message = Some(message);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::config::{
        BluetoothConnectionConfig, ConnectionConfig, DeviceConfig, DeviceType,
    };
    use chrono::TimeZone;

    fn sample_config() -> DeviceConfig {
        DeviceConfig {
            id: "dev-1".to_string(),
            name: "Counter Printer".to_string(),
            device_type: DeviceType::ThermalPrinter,
            enabled: true,
            auto_connect: false,
            connection: ConnectionConfig::Bluetooth(BluetoothConnectionConfig {
                device_address: "AA:BB:CC:DD:EE:FF".to_string(),
                service_uuid: None,
                characteristic_uuid: None,
            }),
            settings: None,
        }
    }

    #[test]
    fn from_config_starts_disconnected_and_unknown() {
        let status = DeviceStatus::from_config(&sample_config());

        assert_eq!(status.id, "dev-1");
        assert_eq!(status.name, "Counter Printer");
        assert_eq!(status.device_type, DeviceType::ThermalPrinter);
        // A freshly-discovered device must NOT report healthy/connected until
        // the connect flow proves it — otherwise the UI shows a green dot for
        // an unreachable printer.
        assert_eq!(status.connection_status, ConnectionStatus::Disconnected);
        assert_eq!(status.health, HealthStatus::Unknown);
        assert!(status.last_activity.is_none());
        assert!(status.error_message.is_none());
    }

    #[test]
    fn mark_connected_at_sets_healthy_and_stamps_activity() {
        let mut status = DeviceStatus::from_config(&sample_config());
        let when = Utc.with_ymd_and_hms(2026, 6, 14, 12, 30, 0).unwrap();

        status.mark_connected_at(when);

        assert_eq!(status.connection_status, ConnectionStatus::Connected);
        assert_eq!(status.health, HealthStatus::Healthy);
        // Clock injection lets us assert the exact stamped instant.
        assert_eq!(status.last_activity, Some(when));
        assert!(status.error_message.is_none());
    }

    #[test]
    fn mark_error_then_disconnect_clears_error() {
        let mut status = DeviceStatus::from_config(&sample_config());

        status.mark_error("paper jam".to_string());
        assert_eq!(status.connection_status, ConnectionStatus::Error);
        assert_eq!(status.health, HealthStatus::Error);
        assert_eq!(status.error_message.as_deref(), Some("paper jam"));

        // Disconnect must wipe the stale error so a later reconnect doesn't
        // surface yesterday's failure.
        status.mark_disconnected();
        assert_eq!(status.connection_status, ConnectionStatus::Disconnected);
        assert_eq!(status.health, HealthStatus::Unknown);
        assert!(status.error_message.is_none());
    }

    #[test]
    fn reconnect_after_error_clears_error_message() {
        let mut status = DeviceStatus::from_config(&sample_config());
        status.mark_error("write failed".to_string());

        let when = Utc.with_ymd_and_hms(2026, 6, 14, 13, 0, 0).unwrap();
        status.mark_connected_at(when);

        assert_eq!(status.connection_status, ConnectionStatus::Connected);
        assert_eq!(status.health, HealthStatus::Healthy);
        assert!(
            status.error_message.is_none(),
            "reconnect must clear the prior error"
        );
    }
}

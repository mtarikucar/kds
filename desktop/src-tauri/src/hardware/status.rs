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
        self.connection_status = ConnectionStatus::Connected;
        self.health = HealthStatus::Healthy;
        self.last_activity = Some(Utc::now());
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

use serde::{Deserialize, Serialize};
use crate::hardware::connections::ConnectionConfig;
use crate::hardware::traits::DeviceType;

/// Device configuration from backend API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceConfig {
    pub id: String,
    pub name: String,
    pub device_type: DeviceType,
    pub enabled: bool,
    pub connection: ConnectionConfig,
    pub settings: serde_json::Value,
    pub auto_connect: bool,
    pub priority: i32,
    #[serde(default)]
    pub metadata: std::collections::HashMap<String, String>,
}

impl DeviceConfig {
    pub fn new(
        id: String,
        name: String,
        device_type: DeviceType,
        connection: ConnectionConfig,
    ) -> Self {
        Self {
            id,
            name,
            device_type,
            enabled: true,
            connection,
            settings: serde_json::Value::Object(serde_json::Map::new()),
            auto_connect: true,
            priority: 0,
            metadata: std::collections::HashMap::new(),
        }
    }

    pub fn with_settings(mut self, settings: serde_json::Value) -> Self {
        self.settings = settings;
        self
    }

    pub fn with_auto_connect(mut self, auto_connect: bool) -> Self {
        self.auto_connect = auto_connect;
        self
    }

    pub fn with_priority(mut self, priority: i32) -> Self {
        self.priority = priority;
        self
    }

    pub fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }
}

/// Hardware configuration container
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HardwareConfig {
    pub devices: Vec<DeviceConfig>,
    pub global_settings: GlobalHardwareSettings,
    #[serde(default)]
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GlobalHardwareSettings {
    #[serde(default = "default_reconnect_enabled")]
    pub auto_reconnect: bool,

    #[serde(default = "default_reconnect_interval")]
    pub reconnect_interval_secs: u64,

    #[serde(default = "default_max_reconnect_attempts")]
    pub max_reconnect_attempts: u32,

    #[serde(default = "default_health_check_enabled")]
    pub enable_health_checks: bool,

    #[serde(default = "default_health_check_interval")]
    pub health_check_interval_secs: u64,

    #[serde(default)]
    pub log_level: String,
}

fn default_reconnect_enabled() -> bool {
    true
}

fn default_reconnect_interval() -> u64 {
    30
}

fn default_max_reconnect_attempts() -> u32 {
    5
}

fn default_health_check_enabled() -> bool {
    true
}

fn default_health_check_interval() -> u64 {
    60
}

impl Default for GlobalHardwareSettings {
    fn default() -> Self {
        Self {
            auto_reconnect: default_reconnect_enabled(),
            reconnect_interval_secs: default_reconnect_interval(),
            max_reconnect_attempts: default_max_reconnect_attempts(),
            enable_health_checks: default_health_check_enabled(),
            health_check_interval_secs: default_health_check_interval(),
            log_level: "info".to_string(),
        }
    }
}

impl HardwareConfig {
    pub fn new() -> Self {
        Self {
            devices: Vec::new(),
            global_settings: GlobalHardwareSettings::default(),
            version: "1.0".to_string(),
        }
    }

    pub fn add_device(&mut self, device: DeviceConfig) {
        self.devices.push(device);
    }

    pub fn get_device(&self, id: &str) -> Option<&DeviceConfig> {
        self.devices.iter().find(|d| d.id == id)
    }

    pub fn get_devices_by_type(&self, device_type: &DeviceType) -> Vec<&DeviceConfig> {
        self.devices
            .iter()
            .filter(|d| d.device_type == *device_type)
            .collect()
    }

    pub fn enabled_devices(&self) -> Vec<&DeviceConfig> {
        self.devices.iter().filter(|d| d.enabled).collect()
    }
}

impl Default for HardwareConfig {
    fn default() -> Self {
        Self::new()
    }
}

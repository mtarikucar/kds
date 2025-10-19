use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use crate::hardware::errors::HardwareResult;

/// Device status information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceStatus {
    pub id: String,
    pub name: String,
    pub device_type: DeviceType,
    pub connection_status: ConnectionStatus,
    pub health: HealthStatus,
    pub last_activity: Option<chrono::DateTime<chrono::Utc>>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DeviceType {
    ThermalPrinter,
    CashDrawer,
    RestaurantPager,
    BarcodeReader,
    CustomerDisplay,
    KitchenDisplay,
    ScaleDevice,
    Other(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConnectionStatus {
    Connected,
    Disconnected,
    Connecting,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum HealthStatus {
    Healthy,
    Warning,
    Error,
    Unknown,
}

/// Base trait for all hardware devices
#[async_trait]
pub trait HardwareDevice: Send + Sync {
    /// Get unique device identifier
    fn id(&self) -> &str;

    /// Get device name
    fn name(&self) -> &str;

    /// Get device type
    fn device_type(&self) -> DeviceType;

    /// Initialize the device connection
    async fn connect(&mut self) -> HardwareResult<()>;

    /// Disconnect from the device
    async fn disconnect(&mut self) -> HardwareResult<()>;

    /// Check if device is currently connected
    fn is_connected(&self) -> bool;

    /// Get current device status
    async fn get_status(&self) -> HardwareResult<DeviceStatus>;

    /// Perform a health check on the device
    async fn health_check(&mut self) -> HardwareResult<HealthStatus>;

    /// Reset the device to initial state
    async fn reset(&mut self) -> HardwareResult<()>;

    /// Get device capabilities as JSON
    fn capabilities(&self) -> serde_json::Value;
}

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use crate::hardware::errors::HardwareResult;
use super::device::HardwareDevice;

/// Pager call type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PagerCallType {
    Beep,
    Vibrate,
    BeepAndVibrate,
    Flash,
    Custom(String),
}

/// Pager message data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PagerMessage {
    pub pager_number: u16,
    pub call_type: PagerCallType,
    pub duration_seconds: Option<u8>,
    pub message: Option<String>,
}

/// Pager response status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PagerResponse {
    pub pager_number: u16,
    pub acknowledged: bool,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

/// Restaurant pager device trait
#[async_trait]
pub trait PagerDevice: HardwareDevice {
    /// Call a specific pager number
    async fn call_pager(&mut self, message: &PagerMessage) -> HardwareResult<()>;

    /// Cancel an active pager call
    async fn cancel_pager(&mut self, pager_number: u16) -> HardwareResult<()>;

    /// Check if a pager is in range
    async fn check_pager_in_range(&mut self, pager_number: u16) -> HardwareResult<bool>;

    /// Get list of all pagers in range
    async fn list_pagers_in_range(&mut self) -> HardwareResult<Vec<u16>>;

    /// Set base station configuration
    async fn configure_base_station(&mut self, config: serde_json::Value) -> HardwareResult<()>;

    /// Get pager battery status (if supported)
    async fn get_pager_battery(&mut self, pager_number: u16) -> HardwareResult<Option<u8>>;
}

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use crate::hardware::errors::HardwareResult;
use super::device::HardwareDevice;

/// Cash drawer status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DrawerStatus {
    Open,
    Closed,
    Unknown,
}

/// Cash drawer device trait
#[async_trait]
pub trait CashDrawerDevice: HardwareDevice {
    /// Open the cash drawer
    async fn open(&mut self) -> HardwareResult<()>;

    /// Get current drawer status
    async fn get_drawer_status(&mut self) -> HardwareResult<DrawerStatus>;

    /// Check if drawer is open
    async fn is_open(&mut self) -> HardwareResult<bool> {
        let status = self.get_drawer_status().await?;
        Ok(status == DrawerStatus::Open)
    }

    /// Wait for drawer to be closed (with timeout in seconds)
    async fn wait_for_close(&mut self, timeout_secs: u64) -> HardwareResult<bool>;

    /// Trigger alert when drawer is opened (if supported)
    async fn enable_open_alert(&mut self, enable: bool) -> HardwareResult<()>;
}

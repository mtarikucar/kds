use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use crate::hardware::errors::HardwareResult;
use super::device::HardwareDevice;

/// Barcode scan result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BarcodeScanResult {
    pub data: String,
    pub barcode_type: String,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub quality: Option<u8>, // 0-100 quality score
}

/// Barcode reader mode
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ScanMode {
    Continuous,    // Continuously scan
    SingleShot,    // Scan once per trigger
    Manual,        // Require explicit trigger
}

/// Barcode reader device trait
#[async_trait]
pub trait BarcodeReaderDevice: HardwareDevice {
    /// Start listening for barcode scans
    async fn start_scanning(&mut self, mode: ScanMode) -> HardwareResult<()>;

    /// Stop scanning
    async fn stop_scanning(&mut self) -> HardwareResult<()>;

    /// Manually trigger a scan (for Manual mode)
    async fn trigger_scan(&mut self) -> HardwareResult<Option<BarcodeScanResult>>;

    /// Get the last scanned barcode
    async fn get_last_scan(&self) -> HardwareResult<Option<BarcodeScanResult>>;

    /// Configure scanner settings (beep, LED, etc.)
    async fn configure(&mut self, config: serde_json::Value) -> HardwareResult<()>;

    /// Enable/disable scan beep sound
    async fn set_beep_enabled(&mut self, enabled: bool) -> HardwareResult<()>;

    /// Get supported barcode types
    fn supported_barcode_types(&self) -> Vec<String>;
}

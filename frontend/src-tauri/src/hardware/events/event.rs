use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

/// Hardware event types
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum HardwareEvent {
    /// Device connected successfully
    DeviceConnected {
        device_id: String,
        device_name: String,
        timestamp: DateTime<Utc>,
    },

    /// Device disconnected
    DeviceDisconnected {
        device_id: String,
        device_name: String,
        reason: Option<String>,
        timestamp: DateTime<Utc>,
    },

    /// Device error occurred
    DeviceError {
        device_id: String,
        device_name: String,
        error: String,
        timestamp: DateTime<Utc>,
    },

    /// Device status changed
    DeviceStatusChanged {
        device_id: String,
        device_name: String,
        old_status: String,
        new_status: String,
        timestamp: DateTime<Utc>,
    },

    // Printer Events
    /// Paper is running low
    PaperLow {
        device_id: String,
        timestamp: DateTime<Utc>,
    },

    /// Paper is out
    PaperOut {
        device_id: String,
        timestamp: DateTime<Utc>,
    },

    /// Print job completed
    PrintCompleted {
        device_id: String,
        job_id: Option<String>,
        timestamp: DateTime<Utc>,
    },

    /// Print job failed
    PrintFailed {
        device_id: String,
        job_id: Option<String>,
        error: String,
        timestamp: DateTime<Utc>,
    },

    // Cash Drawer Events
    /// Cash drawer opened
    DrawerOpened {
        device_id: String,
        timestamp: DateTime<Utc>,
    },

    /// Cash drawer closed
    DrawerClosed {
        device_id: String,
        duration_secs: Option<u64>,
        timestamp: DateTime<Utc>,
    },

    /// Cash drawer left open too long
    DrawerOpenAlert {
        device_id: String,
        duration_secs: u64,
        timestamp: DateTime<Utc>,
    },

    // Pager Events
    /// Pager called
    PagerCalled {
        device_id: String,
        pager_number: u16,
        timestamp: DateTime<Utc>,
    },

    /// Pager responded
    PagerResponded {
        device_id: String,
        pager_number: u16,
        timestamp: DateTime<Utc>,
    },

    /// Pager out of range
    PagerOutOfRange {
        device_id: String,
        pager_number: u16,
        timestamp: DateTime<Utc>,
    },

    // Barcode Reader Events
    /// Barcode scanned
    BarcodeScanned {
        device_id: String,
        barcode_data: String,
        barcode_type: String,
        timestamp: DateTime<Utc>,
    },

    /// Scan error
    ScanError {
        device_id: String,
        error: String,
        timestamp: DateTime<Utc>,
    },

    // Generic Events
    /// Custom event for extensibility
    Custom {
        device_id: String,
        event_name: String,
        data: serde_json::Value,
        timestamp: DateTime<Utc>,
    },
}

impl HardwareEvent {
    pub fn device_id(&self) -> &str {
        match self {
            HardwareEvent::DeviceConnected { device_id, .. } => device_id,
            HardwareEvent::DeviceDisconnected { device_id, .. } => device_id,
            HardwareEvent::DeviceError { device_id, .. } => device_id,
            HardwareEvent::DeviceStatusChanged { device_id, .. } => device_id,
            HardwareEvent::PaperLow { device_id, .. } => device_id,
            HardwareEvent::PaperOut { device_id, .. } => device_id,
            HardwareEvent::PrintCompleted { device_id, .. } => device_id,
            HardwareEvent::PrintFailed { device_id, .. } => device_id,
            HardwareEvent::DrawerOpened { device_id, .. } => device_id,
            HardwareEvent::DrawerClosed { device_id, .. } => device_id,
            HardwareEvent::DrawerOpenAlert { device_id, .. } => device_id,
            HardwareEvent::PagerCalled { device_id, .. } => device_id,
            HardwareEvent::PagerResponded { device_id, .. } => device_id,
            HardwareEvent::PagerOutOfRange { device_id, .. } => device_id,
            HardwareEvent::BarcodeScanned { device_id, .. } => device_id,
            HardwareEvent::ScanError { device_id, .. } => device_id,
            HardwareEvent::Custom { device_id, .. } => device_id,
        }
    }

    pub fn timestamp(&self) -> &DateTime<Utc> {
        match self {
            HardwareEvent::DeviceConnected { timestamp, .. } => timestamp,
            HardwareEvent::DeviceDisconnected { timestamp, .. } => timestamp,
            HardwareEvent::DeviceError { timestamp, .. } => timestamp,
            HardwareEvent::DeviceStatusChanged { timestamp, .. } => timestamp,
            HardwareEvent::PaperLow { timestamp, .. } => timestamp,
            HardwareEvent::PaperOut { timestamp, .. } => timestamp,
            HardwareEvent::PrintCompleted { timestamp, .. } => timestamp,
            HardwareEvent::PrintFailed { timestamp, .. } => timestamp,
            HardwareEvent::DrawerOpened { timestamp, .. } => timestamp,
            HardwareEvent::DrawerClosed { timestamp, .. } => timestamp,
            HardwareEvent::DrawerOpenAlert { timestamp, .. } => timestamp,
            HardwareEvent::PagerCalled { timestamp, .. } => timestamp,
            HardwareEvent::PagerResponded { timestamp, .. } => timestamp,
            HardwareEvent::PagerOutOfRange { timestamp, .. } => timestamp,
            HardwareEvent::BarcodeScanned { timestamp, .. } => timestamp,
            HardwareEvent::ScanError { timestamp, .. } => timestamp,
            HardwareEvent::Custom { timestamp, .. } => timestamp,
        }
    }

    pub fn event_name(&self) -> &'static str {
        match self {
            HardwareEvent::DeviceConnected { .. } => "device_connected",
            HardwareEvent::DeviceDisconnected { .. } => "device_disconnected",
            HardwareEvent::DeviceError { .. } => "device_error",
            HardwareEvent::DeviceStatusChanged { .. } => "device_status_changed",
            HardwareEvent::PaperLow { .. } => "paper_low",
            HardwareEvent::PaperOut { .. } => "paper_out",
            HardwareEvent::PrintCompleted { .. } => "print_completed",
            HardwareEvent::PrintFailed { .. } => "print_failed",
            HardwareEvent::DrawerOpened { .. } => "drawer_opened",
            HardwareEvent::DrawerClosed { .. } => "drawer_closed",
            HardwareEvent::DrawerOpenAlert { .. } => "drawer_open_alert",
            HardwareEvent::PagerCalled { .. } => "pager_called",
            HardwareEvent::PagerResponded { .. } => "pager_responded",
            HardwareEvent::PagerOutOfRange { .. } => "pager_out_of_range",
            HardwareEvent::BarcodeScanned { .. } => "barcode_scanned",
            HardwareEvent::ScanError { .. } => "scan_error",
            HardwareEvent::Custom { event_name, .. } => "custom",
        }
    }
}

pub mod errors;
pub mod traits;
pub mod connections;
pub mod devices;
pub mod events;
pub mod config;
pub mod factory;
pub mod api;
pub mod manager;

// Re-export commonly used types
pub use errors::{HardwareError, HardwareResult};
pub use traits::{
    HardwareDevice, PrinterDevice, CashDrawerDevice, PagerDevice, BarcodeReaderDevice,
    DeviceStatus, DeviceType, ConnectionStatus, HealthStatus,
    ReceiptData, ReceiptItem, KitchenOrderData, KitchenOrderItem,
    PagerMessage, BarcodeScanResult,
};
pub use events::{HardwareEvent, HardwareEventEmitter};
pub use config::{DeviceConfig, HardwareConfig, DeviceRegistry};
pub use factory::{DeviceFactory, ConnectionFactory};
pub use api::BackendClient;
pub use manager::HardwareManager;

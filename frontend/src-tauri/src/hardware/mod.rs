pub mod api;
pub mod config;
pub mod connections;
pub mod devices;
pub mod errors;
pub mod events;
pub mod factory;
pub mod manager;
pub mod traits;

// Re-export commonly used types
pub use api::BackendClient;
pub use config::{DeviceConfig, DeviceRegistry, HardwareConfig};
pub use errors::{HardwareError, HardwareResult};
pub use events::{HardwareEvent, HardwareEventEmitter};
pub use factory::{ConnectionFactory, DeviceFactory};
pub use manager::HardwareManager;
pub use traits::{
    BarcodeReaderDevice, BarcodeScanResult, CashDrawerDevice, ConnectionStatus, DeviceStatus,
    DeviceType, HardwareDevice, HealthStatus, KitchenOrderData, KitchenOrderItem, PagerDevice,
    PagerMessage, PrinterDevice, ReceiptData, ReceiptItem,
};

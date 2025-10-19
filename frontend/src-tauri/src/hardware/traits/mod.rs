pub mod device;
pub mod printer;
pub mod cash_drawer;
pub mod pager;
pub mod barcode_reader;

// Re-export commonly used types
pub use device::{
    HardwareDevice, DeviceStatus, DeviceType,
    ConnectionStatus, HealthStatus
};
pub use printer::{
    PrinterDevice, ReceiptData, ReceiptItem, KitchenOrderData,
    KitchenOrderItem, OrderPriority, TextAlignment, TextStyle,
    PaperStatus, BarcodeType
};
pub use cash_drawer::{CashDrawerDevice, DrawerStatus};
pub use pager::{PagerDevice, PagerMessage, PagerCallType, PagerResponse};
pub use barcode_reader::{BarcodeReaderDevice, BarcodeScanResult, ScanMode};

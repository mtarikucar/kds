pub mod barcode_reader;
pub mod cash_drawer;
pub mod device;
pub mod pager;
pub mod printer;

// Re-export commonly used types
pub use device::{ConnectionStatus, DeviceStatus, DeviceType, HardwareDevice, HealthStatus};
// Only the top-level snapshot structs are consumed outside this module
// (commands + manager + escpos renderer). The nested field structs
// (ReceiptOrder/ReceiptTotals/…) and SNAPSHOT_VERSION are used within
// printer.rs itself, so they're not re-exported to keep the crate warning
// free under `-D warnings`.
pub use barcode_reader::{BarcodeReaderDevice, BarcodeScanResult, ScanMode};
pub use cash_drawer::{CashDrawerDevice, DrawerStatus};
pub use pager::{PagerCallType, PagerDevice, PagerMessage, PagerResponse};
pub use printer::{
    BarcodeType, KitchenOrderData, KitchenOrderItem, PaperStatus, PrinterDevice, ReceiptData,
    ReceiptItem, TextAlignment, TextStyle,
};

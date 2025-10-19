use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use crate::hardware::errors::HardwareResult;
use super::device::HardwareDevice;

/// Receipt data structure
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiptData {
    pub order_id: String,
    pub items: Vec<ReceiptItem>,
    pub subtotal: f64,
    pub tax: f64,
    pub total: f64,
    pub payment_method: String,
    pub table_number: Option<String>,
    pub customer_name: Option<String>,
    pub notes: Option<String>,
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReceiptItem {
    pub name: String,
    pub quantity: i32,
    pub unit_price: f64,
    pub total_price: f64,
    pub modifiers: Option<Vec<String>>,
    pub notes: Option<String>,
}

/// Kitchen order ticket data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KitchenOrderData {
    pub order_id: String,
    pub table_number: Option<String>,
    pub items: Vec<KitchenOrderItem>,
    pub priority: OrderPriority,
    pub timestamp: chrono::DateTime<chrono::Utc>,
    pub special_instructions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KitchenOrderItem {
    pub name: String,
    pub quantity: i32,
    pub modifiers: Option<Vec<String>>,
    pub cooking_instructions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum OrderPriority {
    Low,
    Normal,
    High,
    Urgent,
}

/// Text alignment options
#[derive(Debug, Clone, Copy)]
pub enum TextAlignment {
    Left,
    Center,
    Right,
}

/// Text style options
#[derive(Debug, Clone)]
pub struct TextStyle {
    pub bold: bool,
    pub underline: bool,
    pub double_height: bool,
    pub double_width: bool,
    pub inverted: bool,
}

impl Default for TextStyle {
    fn default() -> Self {
        Self {
            bold: false,
            underline: false,
            double_height: false,
            double_width: false,
            inverted: false,
        }
    }
}

/// Printer device trait
#[async_trait]
pub trait PrinterDevice: HardwareDevice {
    /// Print a customer receipt
    async fn print_receipt(&mut self, receipt: &ReceiptData) -> HardwareResult<()>;

    /// Print a kitchen order ticket
    async fn print_kitchen_order(&mut self, order: &KitchenOrderData) -> HardwareResult<()>;

    /// Print raw text with optional styling
    async fn print_text(
        &mut self,
        text: &str,
        alignment: TextAlignment,
        style: TextStyle,
    ) -> HardwareResult<()>;

    /// Print a line separator
    async fn print_line(&mut self, character: char, length: usize) -> HardwareResult<()>;

    /// Feed paper (advance by number of lines)
    async fn feed_paper(&mut self, lines: u8) -> HardwareResult<()>;

    /// Cut paper (full or partial cut)
    async fn cut_paper(&mut self, partial: bool) -> HardwareResult<()>;

    /// Open cash drawer connected to printer
    async fn open_cash_drawer(&mut self) -> HardwareResult<()>;

    /// Check printer paper status
    async fn check_paper_status(&mut self) -> HardwareResult<PaperStatus>;

    /// Print barcode
    async fn print_barcode(&mut self, data: &str, barcode_type: BarcodeType) -> HardwareResult<()>;

    /// Print QR code
    async fn print_qr_code(&mut self, data: &str, size: u8) -> HardwareResult<()>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PaperStatus {
    Ok,
    NearEnd,
    Out,
    Unknown,
}

#[derive(Debug, Clone, Copy)]
pub enum BarcodeType {
    Code39,
    Code128,
    Ean13,
    Ean8,
    Upca,
    Upce,
}

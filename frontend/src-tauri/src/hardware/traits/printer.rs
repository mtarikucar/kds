use super::device::HardwareDevice;
use crate::hardware::errors::HardwareResult;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Receipt / kitchen-ticket snapshot contract.
//
// These structs MUST stay byte-compatible with the versioned snapshot the
// backend produces (ReceiptSnapshotBuilder, see
// backend/src/modules/orders/services/receipt-snapshot.builder.ts) and the
// frontend ships VERBATIM to the desktop app:
//   - HardwareService.printReceipt(deviceId, ReceiptSnapshot)   -> print_receipt
//   - HardwareService.printKitchenOrder(deviceId, KitchenTicketSnapshot)
//                                                               -> print_kitchen_order
// (frontend/src/lib/tauri.ts:168-205, types frontend/src/types/hardware.ts).
//
// The JSON is camelCase + nested + decimal-bearing fields are STRINGS
// ("118.00"), so `#[serde(rename_all = "camelCase")]` maps the keys and the
// decimals stay as `String` (printed verbatim — no float round-trip drift).
//
// SNAPSHOT VERSION: 1 (RECEIPT_SNAPSHOT_VERSION). If the backend bumps the
// version with a non-additive change, this contract MUST be reconciled and
// the deserialization test below updated. Additive optional fields are safe.
// ---------------------------------------------------------------------------

/// Snapshot schema version the desktop renderer understands.
pub const SNAPSHOT_VERSION: u32 = 1;

/// Versioned receipt snapshot (matches `ReceiptSnapshot` on the frontend).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptData {
    pub version: u32,
    pub restaurant: ReceiptRestaurant,
    pub order: ReceiptOrder,
    pub items: Vec<ReceiptItem>,
    pub totals: ReceiptTotals,
    pub payment: ReceiptPayment,
    /// ISO-8601 timestamp the snapshot was produced for printing.
    pub printed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptRestaurant {
    pub name: String,
    pub currency: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptOrder {
    pub id: String,
    pub order_number: String,
    #[serde(rename = "type")]
    pub order_type: String,
    pub table_number: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptItem {
    pub name: String,
    pub quantity: i32,
    /// Decimal as string, e.g. "59.00".
    pub unit_price: String,
    /// Decimal as string, e.g. "118.00".
    pub total_price: String,
    #[serde(default)]
    pub modifiers: Vec<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptTotals {
    pub subtotal: String,
    pub tax: String,
    pub discount: String,
    pub total: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptPayment {
    pub method: String,
    pub transaction_id: Option<String>,
    pub paid_at: String,
}

/// Versioned kitchen-ticket snapshot (matches `KitchenTicketSnapshot` on the
/// frontend).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitchenOrderData {
    pub version: u32,
    pub order: KitchenOrder,
    pub items: Vec<KitchenOrderItem>,
    pub special_instructions: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitchenOrder {
    pub id: String,
    pub order_number: String,
    #[serde(rename = "type")]
    pub order_type: String,
    pub table_number: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KitchenOrderItem {
    pub name: String,
    pub quantity: i32,
    #[serde(default)]
    pub modifiers: Vec<String>,
    pub notes: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Real backend snapshot JSON — kept byte-identical to the output of
    /// `ReceiptSnapshotBuilder.buildReceiptSnapshot`
    /// (backend/src/modules/orders/services/receipt-snapshot.builder.ts and
    /// its .spec.ts). This is the EXACT payload the frontend ships verbatim via
    /// `HardwareService.printReceipt(deviceId, snapshot)` (frontend/src/lib/
    /// tauri.ts:168). If this fails to deserialize, auto-print is dead at the
    /// serde boundary (the regression this test guards against).
    const RECEIPT_SNAPSHOT_JSON: &str = r#"{
        "version": 1,
        "restaurant": { "name": "Test Diner", "currency": "TRY" },
        "order": {
            "id": "ord_123",
            "orderNumber": "A-42",
            "type": "DINE_IN",
            "tableNumber": "7",
            "notes": "no onions"
        },
        "items": [
            {
                "name": "Burger",
                "quantity": 2,
                "unitPrice": "59.00",
                "totalPrice": "118.00",
                "modifiers": ["extra cheese", "well done"],
                "notes": null
            },
            {
                "name": "Cola",
                "quantity": 1,
                "unitPrice": "25.00",
                "totalPrice": "25.00",
                "modifiers": [],
                "notes": "no ice"
            }
        ],
        "totals": {
            "subtotal": "143.00",
            "tax": "28.60",
            "discount": "0.00",
            "total": "171.60"
        },
        "payment": {
            "method": "CASH",
            "transactionId": null,
            "paidAt": "2026-06-24T10:00:00.000Z"
        },
        "printedAt": "2026-06-24T10:00:01.000Z"
    }"#;

    const KITCHEN_SNAPSHOT_JSON: &str = r#"{
        "version": 1,
        "order": {
            "id": "ord_123",
            "orderNumber": "A-42",
            "type": "DINE_IN",
            "tableNumber": "7"
        },
        "items": [
            {
                "name": "Burger",
                "quantity": 2,
                "modifiers": ["extra cheese"],
                "notes": "well done"
            }
        ],
        "specialInstructions": "rush",
        "createdAt": "2026-06-24T10:00:00.000Z"
    }"#;

    #[test]
    fn deserializes_backend_receipt_snapshot() {
        let receipt: ReceiptData = serde_json::from_str(RECEIPT_SNAPSHOT_JSON)
            .expect("backend receipt snapshot must deserialize into ReceiptData");

        assert_eq!(receipt.version, SNAPSHOT_VERSION);
        assert_eq!(receipt.restaurant.name, "Test Diner");
        assert_eq!(receipt.restaurant.currency, "TRY");
        // camelCase + the `type` keyword rename land on the right fields.
        assert_eq!(receipt.order.order_number, "A-42");
        assert_eq!(receipt.order.order_type, "DINE_IN");
        assert_eq!(receipt.order.table_number.as_deref(), Some("7"));
        assert_eq!(receipt.items.len(), 2);
        assert_eq!(receipt.items[0].total_price, "118.00");
        assert_eq!(
            receipt.items[0].modifiers,
            vec!["extra cheese", "well done"]
        );
        assert!(receipt.items[1].modifiers.is_empty());
        assert_eq!(receipt.items[1].notes.as_deref(), Some("no ice"));
        // Decimal-bearing fields stay verbatim strings — no float drift.
        assert_eq!(receipt.totals.total, "171.60");
        assert_eq!(receipt.payment.method, "CASH");
        assert!(receipt.payment.transaction_id.is_none());
        assert_eq!(receipt.printed_at, "2026-06-24T10:00:01.000Z");
    }

    #[test]
    fn deserializes_backend_kitchen_snapshot() {
        let ticket: KitchenOrderData = serde_json::from_str(KITCHEN_SNAPSHOT_JSON)
            .expect("backend kitchen snapshot must deserialize into KitchenOrderData");

        assert_eq!(ticket.version, SNAPSHOT_VERSION);
        assert_eq!(ticket.order.order_number, "A-42");
        assert_eq!(ticket.order.order_type, "DINE_IN");
        assert_eq!(ticket.items.len(), 1);
        assert_eq!(ticket.items[0].name, "Burger");
        assert_eq!(ticket.items[0].modifiers, vec!["extra cheese"]);
        assert_eq!(ticket.items[0].notes.as_deref(), Some("well done"));
        assert_eq!(ticket.special_instructions.as_deref(), Some("rush"));
    }

    /// A null `tableNumber` (counter/takeaway order) must deserialize to None,
    /// not error — the snapshot uses `null` for tableless orders.
    #[test]
    fn receipt_snapshot_allows_null_table_number() {
        let json = RECEIPT_SNAPSHOT_JSON.replace("\"tableNumber\": \"7\"", "\"tableNumber\": null");
        let receipt: ReceiptData =
            serde_json::from_str(&json).expect("null tableNumber must deserialize");
        assert!(receipt.order.table_number.is_none());
    }
}

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bluetooth;
mod escpos;
mod hardware;

use bluetooth::{BluetoothManager, PrinterCommand, ScannedDevice};
use std::sync::Arc;
use tauri::{Manager, State};
use tokio::sync::Mutex;

/// Application state holding the Bluetooth manager
struct AppState {
    bluetooth: Arc<Mutex<Option<BluetoothManager>>>,
}

/// Initialize Bluetooth manager
#[tauri::command]
async fn init_bluetooth(state: State<'_, AppState>) -> Result<String, String> {
    let manager = BluetoothManager::new()
        .await
        .map_err(|e| e.to_string())?;

    {
        let mut bt = state.bluetooth.lock().await;
        *bt = Some(manager);
    }

    Ok("Bluetooth initialized successfully".to_string())
}

/// Scan for Bluetooth devices
#[tauri::command]
async fn scan_devices(
    duration: u64,
    state: State<'_, AppState>,
) -> Result<Vec<ScannedDevice>, String> {
    let bt = state.bluetooth.lock().await;
    let manager = bt
        .as_ref()
        .ok_or("Bluetooth not initialized. Call init_bluetooth first.")?;

    let devices = manager
        .scan_devices(duration)
        .await
        .map_err(|e| e.to_string())?;

    Ok(devices)
}

/// Connect to a Bluetooth device
#[tauri::command]
async fn connect_device(device_id: String, state: State<'_, AppState>) -> Result<String, String> {
    let bt = state.bluetooth.lock().await;
    let manager = bt
        .as_ref()
        .ok_or("Bluetooth not initialized")?;

    manager
        .connect_device(&device_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(format!("Connected to device: {}", device_id))
}

/// Disconnect from a Bluetooth device
#[tauri::command]
async fn disconnect_device(
    device_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let bt = state.bluetooth.lock().await;
    let manager = bt
        .as_ref()
        .ok_or("Bluetooth not initialized")?;

    manager
        .disconnect_device(&device_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(format!("Disconnected from device: {}", device_id))
}

/// Get list of connected devices
#[tauri::command]
async fn get_connected_devices(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let bt = state.bluetooth.lock().await;
    let manager = bt
        .as_ref()
        .ok_or("Bluetooth not initialized")?;

    Ok(manager.get_connected_devices())
}

/// Write data to a characteristic
#[tauri::command]
async fn write_characteristic(
    device_id: String,
    characteristic_uuid: String,
    data: Vec<u8>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let bt = state.bluetooth.lock().await;
    let manager = bt
        .as_ref()
        .ok_or("Bluetooth not initialized")?;

    manager
        .write_characteristic(&device_id, &characteristic_uuid, &data)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Data written successfully".to_string())
}

/// Read data from a characteristic
#[tauri::command]
async fn read_characteristic(
    device_id: String,
    characteristic_uuid: String,
    state: State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    let bt = state.bluetooth.lock().await;
    let manager = bt
        .as_ref()
        .ok_or("Bluetooth not initialized")?;

    let data = manager
        .read_characteristic(&device_id, &characteristic_uuid)
        .await
        .map_err(|e| e.to_string())?;

    Ok(data)
}

/// Print a receipt. Accepts the versioned snapshot shape that the backend
/// persists on Payment.receiptSnapshot — frontend can pass it through
/// without translation.
#[tauri::command]
async fn print_receipt(
    device_id: String,
    receipt: ReceiptSnapshot,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let bt = state.bluetooth.lock().await;
    let manager = bt
        .as_ref()
        .ok_or("Bluetooth not initialized")?;

    let commands = build_receipt_commands(&receipt);

    manager
        .print(&device_id, commands)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Receipt printed successfully".to_string())
}

/// Print a kitchen ticket. Accepts the kitchenTicketSnapshot shape that
/// orders.service.create persists on Order.kitchenTicketSnapshot.
#[tauri::command]
async fn print_kitchen_order(
    device_id: String,
    ticket: KitchenTicketSnapshot,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let bt = state.bluetooth.lock().await;
    let manager = bt
        .as_ref()
        .ok_or("Bluetooth not initialized")?;

    let commands = build_kitchen_ticket_commands(&ticket);

    manager
        .print(&device_id, commands)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Kitchen ticket printed successfully".to_string())
}

/// Open the cash drawer connected to a thermal printer.
///
/// ESC/POS sends a "drawer kick-out" pulse: ESC p m t1 t2 — `m=0` selects
/// pin 2 (the standard cash-drawer pin on Epson + Star + most clones),
/// `t1=50` and `t2=250` give a ~25ms on / 250ms off pulse the drawer
/// solenoid responds to.
#[tauri::command]
async fn open_cash_drawer(
    device_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let bt = state.bluetooth.lock().await;
    let manager = bt
        .as_ref()
        .ok_or("Bluetooth not initialized")?;

    let pulse = vec![0x1B, 0x70, 0x00, 0x32, 0xFA];
    manager
        .write_characteristic(&device_id, "0000ff01-0000-1000-8000-00805f9b34fb", &pulse)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Cash drawer opened".to_string())
}

/// Backend-shape receipt snapshot (Payment.receiptSnapshot, version 1).
/// Mirrors the JSON written by ReceiptSnapshotBuilder in the NestJS
/// backend. New fields can be added as `Option<...>` without bumping
/// `version`. Renamed/removed fields require a v2 + a Rust dispatch on
/// the version field.
#[derive(serde::Deserialize)]
struct ReceiptSnapshot {
    #[allow(dead_code)]
    version: u32,
    restaurant: SnapshotRestaurant,
    order: SnapshotOrderHeader,
    items: Vec<SnapshotItem>,
    totals: SnapshotTotals,
    payment: SnapshotPayment,
    #[allow(dead_code)]
    #[serde(rename = "printedAt")]
    printed_at: String,
}

#[derive(serde::Deserialize)]
struct SnapshotRestaurant {
    name: String,
    currency: String,
}

#[derive(serde::Deserialize)]
struct SnapshotOrderHeader {
    #[allow(dead_code)]
    id: String,
    #[serde(rename = "orderNumber")]
    order_number: String,
    #[allow(dead_code)]
    #[serde(rename = "type")]
    order_type: String,
    #[serde(rename = "tableNumber")]
    table_number: Option<String>,
    notes: Option<String>,
}

#[derive(serde::Deserialize)]
struct SnapshotItem {
    name: String,
    quantity: u32,
    #[allow(dead_code)]
    #[serde(rename = "unitPrice")]
    unit_price: String,
    #[serde(rename = "totalPrice")]
    total_price: String,
    modifiers: Vec<String>,
    notes: Option<String>,
}

#[derive(serde::Deserialize)]
struct SnapshotTotals {
    subtotal: String,
    tax: String,
    discount: String,
    total: String,
}

#[derive(serde::Deserialize)]
struct SnapshotPayment {
    method: String,
    #[allow(dead_code)]
    #[serde(rename = "transactionId")]
    transaction_id: Option<String>,
    #[allow(dead_code)]
    #[serde(rename = "paidAt")]
    paid_at: String,
}

/// Backend-shape kitchen ticket snapshot (Order.kitchenTicketSnapshot, v1).
#[derive(serde::Deserialize)]
struct KitchenTicketSnapshot {
    #[allow(dead_code)]
    version: u32,
    order: SnapshotOrderHeader,
    items: Vec<KitchenItem>,
    #[serde(rename = "specialInstructions")]
    special_instructions: Option<String>,
    #[allow(dead_code)]
    #[serde(rename = "createdAt")]
    created_at: String,
}

#[derive(serde::Deserialize)]
struct KitchenItem {
    name: String,
    quantity: u32,
    modifiers: Vec<String>,
    notes: Option<String>,
}

const SEPARATOR: &str = "--------------------------------";

/// Render a customer receipt as a Vec<PrinterCommand>.
fn build_receipt_commands(r: &ReceiptSnapshot) -> Vec<PrinterCommand> {
    let mut cmds = vec![
        PrinterCommand::Initialize,
        PrinterCommand::Align(1),
        PrinterCommand::Bold(true),
        PrinterCommand::TextSize(2, 2),
        PrinterCommand::TextLine(r.restaurant.name.clone()),
        PrinterCommand::Bold(false),
        PrinterCommand::TextSize(1, 1),
        PrinterCommand::Feed(1),
        PrinterCommand::TextLine(format!("Order #{}", r.order.order_number)),
    ];

    if let Some(table) = &r.order.table_number {
        cmds.push(PrinterCommand::TextLine(format!("Table: {}", table)));
    }

    cmds.push(PrinterCommand::Align(0));
    cmds.push(PrinterCommand::TextLine(SEPARATOR.to_string()));

    for item in &r.items {
        cmds.push(PrinterCommand::TextLine(format!(
            "{} x{:<3} {:>10}",
            item.name, item.quantity, item.total_price
        )));
        for modifier in &item.modifiers {
            cmds.push(PrinterCommand::TextLine(format!("  + {}", modifier)));
        }
        if let Some(notes) = &item.notes {
            cmds.push(PrinterCommand::TextLine(format!("  ({})", notes)));
        }
    }

    cmds.push(PrinterCommand::TextLine(SEPARATOR.to_string()));
    cmds.push(PrinterCommand::TextLine(format!(
        "Subtotal:          {:>10}",
        r.totals.subtotal
    )));
    if r.totals.discount != "0.00" {
        cmds.push(PrinterCommand::TextLine(format!(
            "Discount:          {:>10}",
            r.totals.discount
        )));
    }
    cmds.push(PrinterCommand::TextLine(format!(
        "Tax:               {:>10}",
        r.totals.tax
    )));
    cmds.push(PrinterCommand::Bold(true));
    cmds.push(PrinterCommand::TextLine(format!(
        "TOTAL ({}):    {:>10}",
        r.restaurant.currency, r.totals.total
    )));
    cmds.push(PrinterCommand::Bold(false));

    cmds.push(PrinterCommand::Feed(1));
    cmds.push(PrinterCommand::TextLine(format!("Payment: {}", r.payment.method)));

    if let Some(notes) = &r.order.notes {
        cmds.push(PrinterCommand::Feed(1));
        cmds.push(PrinterCommand::TextLine(format!("Notes: {}", notes)));
    }

    cmds.push(PrinterCommand::Feed(1));
    cmds.push(PrinterCommand::Align(1));
    cmds.push(PrinterCommand::TextLine("Thank you!".to_string()));
    cmds.push(PrinterCommand::Feed(3));
    cmds.push(PrinterCommand::Cut);

    cmds
}

/// Render a kitchen ticket as a Vec<PrinterCommand>. No totals, larger
/// item names, special-instructions footer.
fn build_kitchen_ticket_commands(t: &KitchenTicketSnapshot) -> Vec<PrinterCommand> {
    let mut cmds = vec![
        PrinterCommand::Initialize,
        PrinterCommand::Align(1),
        PrinterCommand::Bold(true),
        PrinterCommand::TextSize(2, 2),
        PrinterCommand::TextLine(format!("Order #{}", t.order.order_number)),
        PrinterCommand::TextSize(1, 1),
        PrinterCommand::Bold(false),
    ];

    if let Some(table) = &t.order.table_number {
        cmds.push(PrinterCommand::TextLine(format!("Table {}", table)));
    }

    cmds.push(PrinterCommand::Align(0));
    cmds.push(PrinterCommand::TextLine(SEPARATOR.to_string()));

    for item in &t.items {
        cmds.push(PrinterCommand::Bold(true));
        cmds.push(PrinterCommand::TextSize(2, 1));
        cmds.push(PrinterCommand::TextLine(format!(
            "{}x  {}",
            item.quantity, item.name
        )));
        cmds.push(PrinterCommand::TextSize(1, 1));
        cmds.push(PrinterCommand::Bold(false));
        for modifier in &item.modifiers {
            cmds.push(PrinterCommand::TextLine(format!("  + {}", modifier)));
        }
        if let Some(notes) = &item.notes {
            cmds.push(PrinterCommand::TextLine(format!("  ({})", notes)));
        }
    }

    if let Some(special) = &t.special_instructions {
        cmds.push(PrinterCommand::TextLine(SEPARATOR.to_string()));
        cmds.push(PrinterCommand::Bold(true));
        cmds.push(PrinterCommand::TextLine(format!("** {} **", special)));
        cmds.push(PrinterCommand::Bold(false));
    }

    cmds.push(PrinterCommand::Feed(3));
    cmds.push(PrinterCommand::Cut);
    cmds
}

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            bluetooth: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            init_bluetooth,
            scan_devices,
            connect_device,
            disconnect_device,
            get_connected_devices,
            write_characteristic,
            read_characteristic,
            print_receipt,
            print_kitchen_order,
            open_cash_drawer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

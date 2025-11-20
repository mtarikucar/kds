// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bluetooth;

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

/// Print a receipt to a Bluetooth printer
#[tauri::command]
async fn print_receipt(
    device_id: String,
    receipt_data: ReceiptData,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let bt = state.bluetooth.lock().await;
    let manager = bt
        .as_ref()
        .ok_or("Bluetooth not initialized")?;

    // Build printer commands from receipt data
    let mut commands = vec![
        PrinterCommand::Initialize,
        PrinterCommand::Align(1), // Center align
        PrinterCommand::Bold(true),
        PrinterCommand::TextSize(2, 2),
        PrinterCommand::TextLine(receipt_data.restaurant_name.clone()),
        PrinterCommand::Bold(false),
        PrinterCommand::TextSize(1, 1),
        PrinterCommand::TextLine(receipt_data.restaurant_address.clone()),
        PrinterCommand::Feed(1),
        PrinterCommand::Align(0), // Left align
    ];

    // Add separator
    commands.push(PrinterCommand::TextLine("--------------------------------".to_string()));

    // Add items
    for item in receipt_data.items {
        let line = format!(
            "{} x{:<3} {:>10}",
            item.name,
            item.quantity,
            format!("{:.2}", item.price)
        );
        commands.push(PrinterCommand::TextLine(line));
    }

    // Add separator
    commands.push(PrinterCommand::TextLine("--------------------------------".to_string()));

    // Add totals
    commands.push(PrinterCommand::TextLine(format!(
        "Subtotal:          {:>10}",
        format!("{:.2}", receipt_data.subtotal)
    )));
    commands.push(PrinterCommand::TextLine(format!(
        "Tax:               {:>10}",
        format!("{:.2}", receipt_data.tax)
    )));
    commands.push(PrinterCommand::Bold(true));
    commands.push(PrinterCommand::TextLine(format!(
        "TOTAL:             {:>10}",
        format!("{:.2}", receipt_data.total)
    )));
    commands.push(PrinterCommand::Bold(false));

    // Add payment method
    commands.push(PrinterCommand::Feed(1));
    commands.push(PrinterCommand::TextLine(format!(
        "Payment: {}",
        receipt_data.payment_method
    )));

    // Add footer
    commands.push(PrinterCommand::Feed(1));
    commands.push(PrinterCommand::Align(1)); // Center align
    commands.push(PrinterCommand::TextLine("Thank you for your order!".to_string()));

    if let Some(order_number) = receipt_data.order_number {
        commands.push(PrinterCommand::Feed(1));
        commands.push(PrinterCommand::TextLine(format!("Order #: {}", order_number)));
    }

    // Add QR code if provided
    if let Some(qr_data) = receipt_data.qr_code_data {
        commands.push(PrinterCommand::Feed(1));
        commands.push(PrinterCommand::QRCode(qr_data));
    }

    // Feed and cut
    commands.push(PrinterCommand::Feed(3));
    commands.push(PrinterCommand::Cut);

    // Send to printer
    manager
        .print(&device_id, commands)
        .await
        .map_err(|e| e.to_string())?;

    Ok("Receipt printed successfully".to_string())
}

/// Receipt data structure
#[derive(serde::Deserialize)]
struct ReceiptData {
    restaurant_name: String,
    restaurant_address: String,
    items: Vec<ReceiptItem>,
    subtotal: f64,
    tax: f64,
    total: f64,
    payment_method: String,
    order_number: Option<String>,
    qr_code_data: Option<String>,
}

#[derive(serde::Deserialize)]
struct ReceiptItem {
    name: String,
    quantity: u32,
    price: f64,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

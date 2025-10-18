// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{CustomMenuItem, Manager, SystemTray, SystemTrayEvent, SystemTrayMenu, SystemTrayMenuItem, Window};

// State to hold printer configuration
struct AppState {
    printer_port: Mutex<Option<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PrinterInfo {
    name: String,
    port: String,
    status: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ReceiptData {
    order_id: String,
    items: Vec<ReceiptItem>,
    total: f64,
    payment_method: String,
    table_number: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ReceiptItem {
    name: String,
    quantity: i32,
    price: f64,
}

// Command to list available serial ports (printers)
#[tauri::command]
fn list_printers() -> Result<Vec<PrinterInfo>, String> {
    match serialport::available_ports() {
        Ok(ports) => {
            let printers: Vec<PrinterInfo> = ports
                .iter()
                .map(|port| PrinterInfo {
                    name: port.port_name.clone(),
                    port: port.port_name.clone(),
                    status: "Available".to_string(),
                })
                .collect();
            Ok(printers)
        }
        Err(e) => Err(format!("Failed to list printers: {}", e)),
    }
}

// Command to set the default printer
#[tauri::command]
fn set_printer(state: tauri::State<AppState>, port: String) -> Result<String, String> {
    let mut printer_port = state.printer_port.lock().unwrap();
    *printer_port = Some(port.clone());
    Ok(format!("Printer set to: {}", port))
}

// Command to get current printer
#[tauri::command]
fn get_printer(state: tauri::State<AppState>) -> Option<String> {
    let printer_port = state.printer_port.lock().unwrap();
    printer_port.clone()
}

// Command to print a receipt
#[tauri::command]
fn print_receipt(
    state: tauri::State<AppState>,
    receipt: ReceiptData,
) -> Result<String, String> {
    let printer_port = state.printer_port.lock().unwrap();

    match printer_port.as_ref() {
        Some(port) => {
            match print_to_thermal_printer(port, &receipt) {
                Ok(_) => Ok("Receipt printed successfully".to_string()),
                Err(e) => Err(format!("Print failed: {}", e)),
            }
        }
        None => Err("No printer configured".to_string()),
    }
}

// Helper function to print to thermal printer
fn print_to_thermal_printer(port: &str, receipt: &ReceiptData) -> Result<(), String> {
    // Open serial port
    let mut port = serialport::new(port, 9600)
        .timeout(std::time::Duration::from_millis(100))
        .open()
        .map_err(|e| format!("Failed to open port: {}", e))?;

    // ESC/POS commands
    let init: &[u8] = &[0x1B, 0x40]; // Initialize printer
    let center: &[u8] = &[0x1B, 0x61, 0x01]; // Center alignment
    let left: &[u8] = &[0x1B, 0x61, 0x00]; // Left alignment
    let bold_on: &[u8] = &[0x1B, 0x45, 0x01]; // Bold on
    let bold_off: &[u8] = &[0x1B, 0x45, 0x00]; // Bold off
    let double_height: &[u8] = &[0x1B, 0x21, 0x30]; // Double height
    let normal_size: &[u8] = &[0x1B, 0x21, 0x00]; // Normal size
    let cut: &[u8] = &[0x1D, 0x56, 0x00]; // Cut paper
    let newline: &[u8] = &[0x0A];

    // Initialize
    port.write_all(init).map_err(|e| e.to_string())?;

    // Header - centered
    port.write_all(center).map_err(|e| e.to_string())?;
    port.write_all(double_height).map_err(|e| e.to_string())?;
    port.write_all(bold_on).map_err(|e| e.to_string())?;
    port.write_all(b"KDS RESTAURANT").map_err(|e| e.to_string())?;
    port.write_all(newline).map_err(|e| e.to_string())?;
    port.write_all(normal_size).map_err(|e| e.to_string())?;
    port.write_all(bold_off).map_err(|e| e.to_string())?;
    port.write_all(newline).map_err(|e| e.to_string())?;

    // Order info
    port.write_all(left).map_err(|e| e.to_string())?;
    port.write_all(format!("Order: #{}\n", receipt.order_id).as_bytes()).map_err(|e| e.to_string())?;

    if let Some(table) = &receipt.table_number {
        port.write_all(format!("Table: {}\n", table).as_bytes()).map_err(|e| e.to_string())?;
    }

    port.write_all(b"--------------------------------\n").map_err(|e| e.to_string())?;

    // Items
    for item in &receipt.items {
        let line = format!(
            "{} x {}    ${:.2}\n",
            item.quantity,
            item.name,
            item.price * item.quantity as f64
        );
        port.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    }

    port.write_all(b"--------------------------------\n").map_err(|e| e.to_string())?;

    // Total
    port.write_all(bold_on).map_err(|e| e.to_string())?;
    port.write_all(format!("TOTAL:        ${:.2}\n", receipt.total).as_bytes()).map_err(|e| e.to_string())?;
    port.write_all(bold_off).map_err(|e| e.to_string())?;
    port.write_all(format!("Payment: {}\n", receipt.payment_method).as_bytes()).map_err(|e| e.to_string())?;

    // Footer
    port.write_all(newline).map_err(|e| e.to_string())?;
    port.write_all(center).map_err(|e| e.to_string())?;
    port.write_all(b"Thank you!\n").map_err(|e| e.to_string())?;
    port.write_all(b"Visit us again\n").map_err(|e| e.to_string())?;
    port.write_all(newline).map_err(|e| e.to_string())?;
    port.write_all(newline).map_err(|e| e.to_string())?;
    port.write_all(newline).map_err(|e| e.to_string())?;

    // Cut paper
    port.write_all(cut).map_err(|e| e.to_string())?;

    Ok(())
}

// Command to print kitchen order
#[tauri::command]
fn print_kitchen_order(
    state: tauri::State<AppState>,
    receipt: ReceiptData,
) -> Result<String, String> {
    let printer_port = state.printer_port.lock().unwrap();

    match printer_port.as_ref() {
        Some(port) => {
            match print_kitchen_ticket(port, &receipt) {
                Ok(_) => Ok("Kitchen order printed successfully".to_string()),
                Err(e) => Err(format!("Print failed: {}", e)),
            }
        }
        None => Err("No printer configured".to_string()),
    }
}

// Helper function for kitchen tickets
fn print_kitchen_ticket(port: &str, receipt: &ReceiptData) -> Result<(), String> {
    let mut port = serialport::new(port, 9600)
        .timeout(std::time::Duration::from_millis(100))
        .open()
        .map_err(|e| format!("Failed to open port: {}", e))?;

    let init: &[u8] = &[0x1B, 0x40];
    let center: &[u8] = &[0x1B, 0x61, 0x01];
    let left: &[u8] = &[0x1B, 0x61, 0x00];
    let bold_on: &[u8] = &[0x1B, 0x45, 0x01];
    let bold_off: &[u8] = &[0x1B, 0x45, 0x00];
    let double_height: &[u8] = &[0x1B, 0x21, 0x30];
    let normal_size: &[u8] = &[0x1B, 0x21, 0x00];
    let cut: &[u8] = &[0x1D, 0x56, 0x00];

    port.write_all(init).map_err(|e| e.to_string())?;
    port.write_all(center).map_err(|e| e.to_string())?;
    port.write_all(double_height).map_err(|e| e.to_string())?;
    port.write_all(bold_on).map_err(|e| e.to_string())?;
    port.write_all(b"KITCHEN ORDER\n").map_err(|e| e.to_string())?;
    port.write_all(normal_size).map_err(|e| e.to_string())?;
    port.write_all(bold_off).map_err(|e| e.to_string())?;
    port.write_all(b"\n").map_err(|e| e.to_string())?;

    port.write_all(left).map_err(|e| e.to_string())?;
    port.write_all(bold_on).map_err(|e| e.to_string())?;
    port.write_all(format!("Order: #{}\n", receipt.order_id).as_bytes()).map_err(|e| e.to_string())?;

    if let Some(table) = &receipt.table_number {
        port.write_all(format!("Table: {}\n", table).as_bytes()).map_err(|e| e.to_string())?;
    }
    port.write_all(bold_off).map_err(|e| e.to_string())?;
    port.write_all(b"--------------------------------\n").map_err(|e| e.to_string())?;

    for item in &receipt.items {
        port.write_all(bold_on).map_err(|e| e.to_string())?;
        port.write_all(format!("{} x {}\n", item.quantity, item.name).as_bytes()).map_err(|e| e.to_string())?;
        port.write_all(bold_off).map_err(|e| e.to_string())?;
    }

    port.write_all(b"\n\n\n").map_err(|e| e.to_string())?;
    port.write_all(cut).map_err(|e| e.to_string())?;

    Ok(())
}

// Command to open cash drawer
#[tauri::command]
fn open_cash_drawer(state: tauri::State<AppState>) -> Result<String, String> {
    let printer_port = state.printer_port.lock().unwrap();

    match printer_port.as_ref() {
        Some(port) => {
            let mut port = serialport::new(port, 9600)
                .timeout(std::time::Duration::from_millis(100))
                .open()
                .map_err(|e| format!("Failed to open port: {}", e))?;

            // ESC/POS command to open cash drawer
            let open_drawer: &[u8] = &[0x1B, 0x70, 0x00, 0x19, 0xFA];
            port.write_all(open_drawer).map_err(|e| e.to_string())?;

            Ok("Cash drawer opened".to_string())
        }
        None => Err("No printer configured".to_string()),
    }
}

// Command to show window
#[tauri::command]
fn show_main_window(window: Window) {
    window.get_window("main").unwrap().show().unwrap();
}

fn main() {
    // Create system tray menu
    let quit = CustomMenuItem::new("quit".to_string(), "Quit");
    let show = CustomMenuItem::new("show".to_string(), "Show");
    let tray_menu = SystemTrayMenu::new()
        .add_item(show)
        .add_native_item(SystemTrayMenuItem::Separator)
        .add_item(quit);

    let system_tray = SystemTray::new().with_menu(tray_menu);

    tauri::Builder::default()
        .manage(AppState {
            printer_port: Mutex::new(None),
        })
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::LeftClick {
                position: _,
                size: _,
                ..
            } => {
                let window = app.get_window("main").unwrap();
                window.show().unwrap();
                window.set_focus().unwrap();
            }
            SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
                "quit" => {
                    std::process::exit(0);
                }
                "show" => {
                    let window = app.get_window("main").unwrap();
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
                _ => {}
            },
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            list_printers,
            set_printer,
            get_printer,
            print_receipt,
            print_kitchen_order,
            open_cash_drawer,
            show_main_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// HummyTummy KDS kiosk — Tauri entrypoint.
//
// Two responsibilities:
//   1. Host the React UI (../dist) inside a Tauri webview.
//   2. Expose a tiny set of commands the web side can invoke to read/write
//      the device token from the OS keyring.
//
// All cloud I/O happens inside the React layer (fetch). The Rust side
// stays minimal so the binary footprint stays small.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use keyring::Entry;
use tauri::Manager;

const SERVICE: &str = "com.hummytummy.kds-kiosk";
const ACCOUNT: &str = "device-token";

/// Load the JSON-encoded device token from the OS keyring, returning
/// `None` when no entry exists. Errors fall through as `Err` strings so
/// the JS side can render a hint.
#[tauri::command]
fn load_device_token() -> Result<Option<String>, String> {
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(v) if v.is_empty() => Ok(None),
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Save the device token, or clear it when `value` is `None`. The token
/// is a JSON string the JS side serialises before calling us.
#[tauri::command]
fn save_device_token(value: Option<String>) -> Result<(), String> {
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match value {
        Some(v) => entry.set_password(&v).map_err(|e| e.to_string()),
        None => match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        },
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_device_token, save_device_token])
        .setup(|app| {
            // Force the main window into fullscreen so the kiosk presents
            // edge-to-edge. Operators can exit via the Unpair button which
            // doesn't actually quit — that's intentional, a tablet-mounted
            // KDS shouldn't have a "minimise" gesture.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_fullscreen(true);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running KDS kiosk");
}

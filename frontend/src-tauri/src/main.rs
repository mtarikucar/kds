// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod hardware;
mod commands;

use tokio::sync::Mutex;
use tauri::{
    Manager,
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
};
use hardware::{HardwareManager, HardwareEventEmitter};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize tracing/logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"))
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Create event emitter for hardware events
            let event_emitter = HardwareEventEmitter::new(app.handle().clone());

            // Create hardware manager
            let hardware_manager = HardwareManager::new(event_emitter);

            // Store hardware manager in app state
            app.manage(Mutex::new(hardware_manager));

            // Create tray icon
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .icon(app.default_window_icon().unwrap().clone())
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            tracing::info!("KDS POS Desktop Application started");

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Hardware management commands
            commands::initialize_hardware,
            commands::list_devices,
            commands::get_device_status,
            commands::has_device,
            commands::reconnect_device,
            commands::shutdown_hardware,

            // Printer commands
            commands::print_receipt,
            commands::print_kitchen_order,
            commands::print_text,
            commands::cut_paper,
            commands::open_cash_drawer_via_printer,
            commands::check_paper_status,

            // Pager commands
            commands::call_pager,
            commands::cancel_pager,
            commands::check_pager_in_range,
            commands::list_pagers_in_range,

            // Barcode reader commands
            commands::start_barcode_scanning,
            commands::stop_barcode_scanning,
            commands::get_last_barcode_scan,
            commands::trigger_barcode_scan,

            // Legacy commands (for backward compatibility)
            show_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Legacy command for backward compatibility
#[tauri::command]
fn show_main_window(window: tauri::Window) {
    let _ = window.show();
    let _ = window.set_focus();
}

fn main() {
    run();
}

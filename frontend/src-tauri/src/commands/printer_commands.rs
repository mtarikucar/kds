use super::hardware_commands::HardwareManagerState;

/// Print text on a printer (advanced).
///
/// NOTE: still a placeholder — the POS receipt/kitchen rails use the
/// snapshot-shaped `print_receipt` / `print_kitchen_order` commands, not this
/// raw-text entry point. Left as a no-op until a callsite needs it; the
/// underlying `PrinterDevice::print_text` already exists in escpos.rs.
#[tauri::command]
pub async fn print_text(
    device_id: String,
    _text: String,
    _alignment: Option<String>,
    _bold: Option<bool>,
    _manager: HardwareManagerState<'_>,
) -> Result<String, String> {
    Ok(format!(
        "Text print command received for device {}",
        device_id
    ))
}

/// Cut paper on a printer.
///
/// NOTE: placeholder — receipt/kitchen prints already cut paper at the end of
/// their own render. Left as a no-op until an explicit-cut callsite exists.
#[tauri::command]
pub async fn cut_paper(
    device_id: String,
    _partial: Option<bool>,
    _manager: HardwareManagerState<'_>,
) -> Result<String, String> {
    Ok(format!(
        "Paper cut command received for device {}",
        device_id
    ))
}

/// Open the cash drawer wired to a printer.
///
/// Dispatches the real ESC/POS drawer-kick pulse via the configured printer
/// (`HardwareManager::open_cash_drawer` -> `EscPosPrinter::open_cash_drawer`,
/// bytes `1B 70 00 19 FA`). The frontend (`HardwareService.openCashDrawer`)
/// invokes THIS exact command name on CASH payments.
#[tauri::command]
pub async fn open_cash_drawer_via_printer(
    device_id: String,
    manager: HardwareManagerState<'_>,
) -> Result<String, String> {
    let mgr = manager.lock().await;
    mgr.open_cash_drawer(&device_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(format!("Cash drawer opened on device {}", device_id))
}

/// Check printer paper status.
///
/// NOTE: placeholder returning "unknown" until real-time DLE EOT status
/// polling is wired through the connection layer.
#[tauri::command]
pub async fn check_paper_status(
    device_id: String,
    _manager: HardwareManagerState<'_>,
) -> Result<String, String> {
    let _ = device_id;
    Ok("unknown".to_string())
}

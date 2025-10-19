use tauri::State;
use crate::hardware::PagerMessage;
use super::hardware_commands::HardwareManagerState;

/// Call a pager
#[tauri::command]
pub async fn call_pager(
    device_id: String,
    message: PagerMessage,
    manager: HardwareManagerState<'_>,
) -> Result<String, String> {
    Ok(format!(
        "Pager {} called via device {}",
        message.pager_number, device_id
    ))
}

/// Cancel a pager call
#[tauri::command]
pub async fn cancel_pager(
    device_id: String,
    pager_number: u16,
    manager: HardwareManagerState<'_>,
) -> Result<String, String> {
    Ok(format!(
        "Pager {} cancelled via device {}",
        pager_number, device_id
    ))
}

/// Check if pager is in range
#[tauri::command]
pub async fn check_pager_in_range(
    device_id: String,
    pager_number: u16,
    manager: HardwareManagerState<'_>,
) -> Result<bool, String> {
    Ok(false)
}

/// List pagers in range
#[tauri::command]
pub async fn list_pagers_in_range(
    device_id: String,
    manager: HardwareManagerState<'_>,
) -> Result<Vec<u16>, String> {
    Ok(vec![])
}

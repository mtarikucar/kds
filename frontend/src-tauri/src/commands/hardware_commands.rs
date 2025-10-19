use tauri::State;
use tokio::sync::Mutex;
use crate::hardware::{
    HardwareManager, DeviceStatus,
    ReceiptData, KitchenOrderData,
};

pub type HardwareManagerState<'a> = State<'a, Mutex<HardwareManager>>;

/// Initialize hardware system from backend
#[tauri::command]
pub async fn initialize_hardware(
    backend_url: String,
    manager: HardwareManagerState<'_>,
) -> Result<String, String> {
    let mut mgr = manager.lock().await;

    // Set backend client
    *mgr = HardwareManager::new(mgr.event_emitter().clone())
        .with_backend_client(backend_url);

    mgr.initialize_from_backend()
        .await
        .map_err(|e| e.to_string())?;

    let count = mgr.device_count().await;
    Ok(format!("Hardware initialized: {} devices", count))
}

/// Get all device statuses
#[tauri::command]
pub async fn list_devices(
    manager: HardwareManagerState<'_>,
) -> Result<Vec<DeviceStatus>, String> {
    let mgr = manager.lock().await;
    Ok(mgr.get_all_device_statuses().await)
}

/// Get status of a specific device
#[tauri::command]
pub async fn get_device_status(
    device_id: String,
    manager: HardwareManagerState<'_>,
) -> Result<DeviceStatus, String> {
    let mgr = manager.lock().await;
    mgr.get_device_status(&device_id)
        .await
        .map_err(|e| e.to_string())
}

/// Check if device exists
#[tauri::command]
pub async fn has_device(
    device_id: String,
    manager: HardwareManagerState<'_>,
) -> Result<bool, String> {
    let mgr = manager.lock().await;
    Ok(mgr.has_device(&device_id).await)
}

/// Print receipt on a specific printer
#[tauri::command]
pub async fn print_receipt(
    device_id: String,
    receipt: ReceiptData,
    manager: HardwareManagerState<'_>,
) -> Result<String, String> {
    let mgr = manager.lock().await;
    mgr.print_receipt(&device_id, &receipt)
        .await
        .map_err(|e| e.to_string())?;

    Ok(format!("Receipt printed on device {}", device_id))
}

/// Print kitchen order on a specific printer
#[tauri::command]
pub async fn print_kitchen_order(
    device_id: String,
    order: KitchenOrderData,
    manager: HardwareManagerState<'_>,
) -> Result<String, String> {
    let mgr = manager.lock().await;
    mgr.print_kitchen_order(&device_id, &order)
        .await
        .map_err(|e| e.to_string())?;

    Ok(format!("Kitchen order printed on device {}", device_id))
}

/// Reconnect a specific device
#[tauri::command]
pub async fn reconnect_device(
    device_id: String,
    manager: HardwareManagerState<'_>,
) -> Result<String, String> {
    let mgr = manager.lock().await;
    mgr.reconnect_device(&device_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(format!("Device {} reconnected", device_id))
}

/// Shutdown hardware system
#[tauri::command]
pub async fn shutdown_hardware(
    manager: HardwareManagerState<'_>,
) -> Result<String, String> {
    let mgr = manager.lock().await;
    mgr.shutdown()
        .await
        .map_err(|e| e.to_string())?;

    Ok("Hardware system shutdown".to_string())
}

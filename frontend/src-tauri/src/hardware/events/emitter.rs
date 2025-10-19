use tauri::{AppHandle, Emitter};
use tokio::sync::broadcast;
use std::sync::Arc;
use super::event::HardwareEvent;

/// Event emitter for hardware events
/// Broadcasts events both internally (via broadcast channel) and to frontend (via Tauri events)
#[derive(Clone)]
pub struct HardwareEventEmitter {
    app_handle: AppHandle,
    broadcast_tx: Arc<broadcast::Sender<HardwareEvent>>,
}

impl HardwareEventEmitter {
    pub fn new(app_handle: AppHandle) -> Self {
        let (broadcast_tx, _) = broadcast::channel(100);
        Self {
            app_handle,
            broadcast_tx: Arc::new(broadcast_tx),
        }
    }

    /// Emit an event to both internal listeners and frontend
    pub fn emit(&self, event: HardwareEvent) {
        // Log the event
        tracing::info!(
            "Hardware event: {} from device {}",
            event.event_name(),
            event.device_id()
        );

        // Send to internal broadcast channel (for Rust-side listeners)
        let _ = self.broadcast_tx.send(event.clone());

        // Send to frontend via Tauri events
        let event_name = format!("hardware:{}", event.event_name());
        if let Err(e) = self.app_handle.emit(&event_name, &event) {
            tracing::error!("Failed to emit event to frontend: {}", e);
        }

        // Also emit a generic hardware event
        if let Err(e) = self.app_handle.emit("hardware:event", &event) {
            tracing::error!("Failed to emit generic hardware event: {}", e);
        }
    }

    /// Subscribe to hardware events (for internal Rust listeners)
    pub fn subscribe(&self) -> broadcast::Receiver<HardwareEvent> {
        self.broadcast_tx.subscribe()
    }

    /// Get the app handle
    pub fn app_handle(&self) -> &AppHandle {
        &self.app_handle
    }
}

// Helper functions to create common events
impl HardwareEventEmitter {
    pub fn emit_device_connected(&self, device_id: String, device_name: String) {
        self.emit(HardwareEvent::DeviceConnected {
            device_id,
            device_name,
            timestamp: chrono::Utc::now(),
        });
    }

    pub fn emit_device_disconnected(
        &self,
        device_id: String,
        device_name: String,
        reason: Option<String>,
    ) {
        self.emit(HardwareEvent::DeviceDisconnected {
            device_id,
            device_name,
            reason,
            timestamp: chrono::Utc::now(),
        });
    }

    pub fn emit_device_error(&self, device_id: String, device_name: String, error: String) {
        self.emit(HardwareEvent::DeviceError {
            device_id,
            device_name,
            error,
            timestamp: chrono::Utc::now(),
        });
    }

    pub fn emit_barcode_scanned(
        &self,
        device_id: String,
        barcode_data: String,
        barcode_type: String,
    ) {
        self.emit(HardwareEvent::BarcodeScanned {
            device_id,
            barcode_data,
            barcode_type,
            timestamp: chrono::Utc::now(),
        });
    }

    pub fn emit_print_completed(&self, device_id: String, job_id: Option<String>) {
        self.emit(HardwareEvent::PrintCompleted {
            device_id,
            job_id,
            timestamp: chrono::Utc::now(),
        });
    }

    pub fn emit_drawer_opened(&self, device_id: String) {
        self.emit(HardwareEvent::DrawerOpened {
            device_id,
            timestamp: chrono::Utc::now(),
        });
    }

    pub fn emit_pager_called(&self, device_id: String, pager_number: u16) {
        self.emit(HardwareEvent::PagerCalled {
            device_id,
            pager_number,
            timestamp: chrono::Utc::now(),
        });
    }
}

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::hardware::errors::{HardwareError, HardwareResult};
use crate::hardware::traits::{HardwareDevice, DeviceStatus};

/// Device registry for managing active hardware devices
pub struct DeviceRegistry {
    devices: Arc<RwLock<HashMap<String, Arc<RwLock<Box<dyn HardwareDevice>>>>>>,
}

impl DeviceRegistry {
    pub fn new() -> Self {
        Self {
            devices: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a new device
    pub async fn register(&self, device: Box<dyn HardwareDevice>) -> HardwareResult<()> {
        let device_id = device.id().to_string();
        let mut devices = self.devices.write().await;

        if devices.contains_key(&device_id) {
            return Err(HardwareError::InitializationError(format!(
                "Device {} already registered",
                device_id
            )));
        }

        devices.insert(device_id.clone(), Arc::new(RwLock::new(device)));
        tracing::info!("Device registered: {}", device_id);
        Ok(())
    }

    /// Unregister a device
    pub async fn unregister(&self, device_id: &str) -> HardwareResult<()> {
        let mut devices = self.devices.write().await;

        if let Some(device_arc) = devices.remove(device_id) {
            let mut device = device_arc.write().await;
            device.disconnect().await?;
            tracing::info!("Device unregistered: {}", device_id);
            Ok(())
        } else {
            Err(HardwareError::DeviceNotFound(device_id.to_string()))
        }
    }

    /// Get a device by ID
    pub async fn get_device(
        &self,
        device_id: &str,
    ) -> HardwareResult<Arc<RwLock<Box<dyn HardwareDevice>>>> {
        let devices = self.devices.read().await;
        devices
            .get(device_id)
            .cloned()
            .ok_or_else(|| HardwareError::DeviceNotFound(device_id.to_string()))
    }

    /// List all registered device IDs
    pub async fn list_device_ids(&self) -> Vec<String> {
        let devices = self.devices.read().await;
        devices.keys().cloned().collect()
    }

    /// Get status of all devices
    pub async fn get_all_statuses(&self) -> Vec<DeviceStatus> {
        let devices = self.devices.read().await;
        let mut statuses = Vec::new();

        for device_arc in devices.values() {
            let device = device_arc.read().await;
            if let Ok(status) = device.get_status().await {
                statuses.push(status);
            }
        }

        statuses
    }

    /// Get status of a specific device
    pub async fn get_device_status(&self, device_id: &str) -> HardwareResult<DeviceStatus> {
        let device_arc = self.get_device(device_id).await?;
        let device = device_arc.read().await;
        device.get_status().await
    }

    /// Check if a device is registered
    pub async fn has_device(&self, device_id: &str) -> bool {
        let devices = self.devices.read().await;
        devices.contains_key(device_id)
    }

    /// Get device count
    pub async fn device_count(&self) -> usize {
        let devices = self.devices.read().await;
        devices.len()
    }

    /// Clear all devices (disconnect and remove)
    pub async fn clear(&self) -> HardwareResult<()> {
        let mut devices = self.devices.write().await;

        for (device_id, device_arc) in devices.drain() {
            let mut device = device_arc.write().await;
            if let Err(e) = device.disconnect().await {
                tracing::warn!("Failed to disconnect device {} during clear: {}", device_id, e);
            }
        }

        tracing::info!("Device registry cleared");
        Ok(())
    }

    /// Execute an operation on a device
    pub async fn with_device<F, R>(&self, device_id: &str, f: F) -> HardwareResult<R>
    where
        F: FnOnce(&mut Box<dyn HardwareDevice>) -> std::pin::Pin<Box<dyn std::future::Future<Output = HardwareResult<R>> + '_>>,
    {
        let device_arc = self.get_device(device_id).await?;
        let mut device = device_arc.write().await;
        f(&mut device).await
    }
}

impl Default for DeviceRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl Clone for DeviceRegistry {
    fn clone(&self) -> Self {
        Self {
            devices: Arc::clone(&self.devices),
        }
    }
}

use async_trait::async_trait;
use hidapi::{HidApi, HidDevice};
use std::sync::Mutex;
use crate::hardware::errors::{HardwareError, HardwareResult};
use super::connection::{Connection, ConnectionType};

pub struct UsbHidConnection {
    vendor_id: u16,
    product_id: u16,
    serial_number: Option<String>,
    timeout_ms: i32,
    device: Option<Mutex<HidDevice>>,
    hid_api: HidApi,
}

impl UsbHidConnection {
    pub fn new(
        vendor_id: u16,
        product_id: u16,
        serial_number: Option<String>,
    ) -> HardwareResult<Self> {
        let hid_api = HidApi::new()
            .map_err(|e| HardwareError::HidError(format!("Failed to initialize HID API: {}", e)))?;

        Ok(Self {
            vendor_id,
            product_id,
            serial_number,
            timeout_ms: 1000,
            device: None,
            hid_api,
        })
    }

    pub fn set_timeout(&mut self, timeout_ms: i32) {
        self.timeout_ms = timeout_ms;
    }
}

#[async_trait]
impl Connection for UsbHidConnection {
    async fn connect(&mut self) -> HardwareResult<()> {
        if self.is_connected() {
            return Ok(());
        }

        let device = if let Some(serial) = &self.serial_number {
            self.hid_api
                .open_serial(self.vendor_id, self.product_id, serial)
                .map_err(|e| HardwareError::HidError(format!(
                    "Failed to open HID device {:04x}:{:04x} ({}): {}",
                    self.vendor_id, self.product_id, serial, e
                )))?
        } else {
            self.hid_api
                .open(self.vendor_id, self.product_id)
                .map_err(|e| HardwareError::HidError(format!(
                    "Failed to open HID device {:04x}:{:04x}: {}",
                    self.vendor_id, self.product_id, e
                )))?
        };

        self.device = Some(Mutex::new(device));
        tracing::info!(
            "USB HID connection established to {:04x}:{:04x}",
            self.vendor_id,
            self.product_id
        );
        Ok(())
    }

    async fn disconnect(&mut self) -> HardwareResult<()> {
        if self.device.take().is_some() {
            tracing::info!(
                "USB HID connection closed to {:04x}:{:04x}",
                self.vendor_id,
                self.product_id
            );
        }
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.device.is_some()
    }

    async fn send(&mut self, data: &[u8]) -> HardwareResult<usize> {
        let device = self.device.as_ref()
            .ok_or_else(|| HardwareError::ConnectionError("Not connected".to_string()))?;

        let device_guard = device.lock().unwrap();
        let written = device_guard.write(data)
            .map_err(|e| HardwareError::HidError(format!("Write failed: {}", e)))?;

        tracing::debug!("Sent {} bytes via USB HID", written);
        Ok(written)
    }

    async fn receive(&mut self, buffer: &mut [u8]) -> HardwareResult<usize> {
        let device = self.device.as_ref()
            .ok_or_else(|| HardwareError::ConnectionError("Not connected".to_string()))?;

        let device_guard = device.lock().unwrap();
        let bytes_read = device_guard.read_timeout(buffer, self.timeout_ms)
            .map_err(|e| HardwareError::HidError(format!("Read failed: {}", e)))?;

        tracing::debug!("Received {} bytes via USB HID", bytes_read);
        Ok(bytes_read)
    }

    async fn flush(&mut self) -> HardwareResult<()> {
        // HID doesn't require explicit flushing
        Ok(())
    }

    fn connection_type(&self) -> ConnectionType {
        ConnectionType::UsbHid
    }

    fn connection_info(&self) -> String {
        format!("USB HID: {:04x}:{:04x}", self.vendor_id, self.product_id)
    }
}

/// List all available HID devices
pub fn list_hid_devices() -> HardwareResult<Vec<(u16, u16, String)>> {
    let api = HidApi::new()
        .map_err(|e| HardwareError::HidError(format!("Failed to initialize HID API: {}", e)))?;

    let devices: Vec<_> = api.device_list()
        .map(|info| {
            (
                info.vendor_id(),
                info.product_id(),
                info.product_string().unwrap_or("Unknown").to_string(),
            )
        })
        .collect();

    Ok(devices)
}

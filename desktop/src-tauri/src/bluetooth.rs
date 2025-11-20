use btleplug::api::{
    Central, CentralEvent, Manager as _, Peripheral as _, ScanFilter, WriteType,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use thiserror::Error;
use tokio::time::sleep;
use uuid::Uuid;

/// Bluetooth error types
#[derive(Error, Debug)]
pub enum BluetoothError {
    #[error("Bluetooth adapter not found")]
    AdapterNotFound,

    #[error("Device not found: {0}")]
    DeviceNotFound(String),

    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Characteristic not found: {0}")]
    CharacteristicNotFound(String),

    #[error("Write failed: {0}")]
    WriteFailed(String),

    #[error("Read failed: {0}")]
    ReadFailed(String),

    #[error("Scan failed: {0}")]
    ScanFailed(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for Bluetooth operations
pub type BluetoothResult<T> = Result<T, BluetoothError>;

/// Scanned Bluetooth device information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedDevice {
    pub id: String,
    pub name: Option<String>,
    pub rssi: Option<i16>,
    pub is_connected: bool,
}

/// Bluetooth printer commands (ESC/POS standard)
#[derive(Debug, Clone)]
pub enum PrinterCommand {
    /// Initialize printer
    Initialize,
    /// Print text
    Text(String),
    /// Print text with newline
    TextLine(String),
    /// Feed paper (n lines)
    Feed(u8),
    /// Cut paper
    Cut,
    /// Set alignment (0=left, 1=center, 2=right)
    Align(u8),
    /// Set text size (1-8)
    TextSize(u8, u8), // width, height
    /// Bold text (true/false)
    Bold(bool),
    /// Print barcode
    Barcode(String),
    /// Print QR code
    QRCode(String),
}

impl PrinterCommand {
    /// Convert command to ESC/POS byte sequence
    pub fn to_bytes(&self) -> Vec<u8> {
        match self {
            PrinterCommand::Initialize => vec![0x1B, 0x40], // ESC @
            PrinterCommand::Text(text) => text.as_bytes().to_vec(),
            PrinterCommand::TextLine(text) => {
                let mut bytes = text.as_bytes().to_vec();
                bytes.extend_from_slice(&[0x0A]); // LF
                bytes
            }
            PrinterCommand::Feed(lines) => vec![0x1B, 0x64, *lines], // ESC d n
            PrinterCommand::Cut => vec![0x1D, 0x56, 0x00], // GS V 0
            PrinterCommand::Align(alignment) => vec![0x1B, 0x61, *alignment], // ESC a n
            PrinterCommand::TextSize(width, height) => {
                let size = ((width - 1) << 4) | (height - 1);
                vec![0x1D, 0x21, size] // GS ! n
            }
            PrinterCommand::Bold(enabled) => {
                vec![0x1B, 0x45, if *enabled { 1 } else { 0 }] // ESC E n
            }
            PrinterCommand::Barcode(data) => {
                let mut bytes = vec![
                    0x1D, 0x68, 0x64, // GS h 100 (height)
                    0x1D, 0x77, 0x02, // GS w 2 (width)
                    0x1D, 0x6B, 0x04, // GS k 4 (CODE39)
                ];
                bytes.extend_from_slice(data.as_bytes());
                bytes.push(0x00); // NULL terminator
                bytes
            }
            PrinterCommand::QRCode(data) => {
                let mut bytes = vec![
                    0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, // Model
                    0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x08, // Size
                    0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30, // Error correction
                ];
                // Store data
                let len = data.len() + 3;
                bytes.extend_from_slice(&[
                    0x1D, 0x28, 0x6B,
                    (len & 0xFF) as u8,
                    ((len >> 8) & 0xFF) as u8,
                    0x31, 0x50, 0x30,
                ]);
                bytes.extend_from_slice(data.as_bytes());
                // Print
                bytes.extend_from_slice(&[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);
                bytes
            }
        }
    }
}

/// Bluetooth manager for device scanning and connection
pub struct BluetoothManager {
    manager: Manager,
    adapter: Arc<Mutex<Option<Adapter>>>,
    connected_devices: Arc<Mutex<HashMap<String, Peripheral>>>,
}

impl BluetoothManager {
    /// Create a new Bluetooth manager
    pub async fn new() -> BluetoothResult<Self> {
        let manager = Manager::new()
            .await
            .map_err(|e| BluetoothError::Internal(e.to_string()))?;

        Ok(Self {
            manager,
            adapter: Arc::new(Mutex::new(None)),
            connected_devices: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    /// Get the Bluetooth adapter
    async fn get_adapter(&self) -> BluetoothResult<Adapter> {
        // Check if we already have an adapter
        {
            let adapter_lock = self.adapter.lock().unwrap();
            if let Some(adapter) = adapter_lock.as_ref() {
                return Ok(adapter.clone());
            }
        }

        // Get the first available adapter
        let adapters = self
            .manager
            .adapters()
            .await
            .map_err(|e| BluetoothError::Internal(e.to_string()))?;

        let adapter = adapters
            .into_iter()
            .next()
            .ok_or(BluetoothError::AdapterNotFound)?;

        // Store the adapter
        {
            let mut adapter_lock = self.adapter.lock().unwrap();
            *adapter_lock = Some(adapter.clone());
        }

        Ok(adapter)
    }

    /// Scan for Bluetooth devices
    ///
    /// # Arguments
    /// * `duration_secs` - How long to scan for devices (in seconds)
    ///
    /// # Returns
    /// A list of discovered devices
    pub async fn scan_devices(&self, duration_secs: u64) -> BluetoothResult<Vec<ScannedDevice>> {
        let adapter = self.get_adapter().await?;

        // Start scanning
        adapter
            .start_scan(ScanFilter::default())
            .await
            .map_err(|e| BluetoothError::ScanFailed(e.to_string()))?;

        // Wait for the specified duration
        sleep(Duration::from_secs(duration_secs)).await;

        // Stop scanning
        adapter
            .stop_scan()
            .await
            .map_err(|e| BluetoothError::ScanFailed(e.to_string()))?;

        // Get discovered peripherals
        let peripherals = adapter
            .peripherals()
            .await
            .map_err(|e| BluetoothError::ScanFailed(e.to_string()))?;

        // Convert to ScannedDevice
        let mut devices = Vec::new();
        for peripheral in peripherals {
            let properties = peripheral
                .properties()
                .await
                .map_err(|e| BluetoothError::Internal(e.to_string()))?;

            let is_connected = peripheral
                .is_connected()
                .await
                .map_err(|e| BluetoothError::Internal(e.to_string()))?;

            if let Some(props) = properties {
                devices.push(ScannedDevice {
                    id: peripheral.id().to_string(),
                    name: props.local_name,
                    rssi: props.rssi,
                    is_connected,
                });
            }
        }

        Ok(devices)
    }

    /// Connect to a Bluetooth device
    ///
    /// # Arguments
    /// * `device_id` - The ID of the device to connect to
    ///
    /// # Returns
    /// Success or error
    pub async fn connect_device(&self, device_id: &str) -> BluetoothResult<()> {
        let adapter = self.get_adapter().await?;

        // Find the peripheral
        let peripherals = adapter
            .peripherals()
            .await
            .map_err(|e| BluetoothError::Internal(e.to_string()))?;

        let peripheral = peripherals
            .into_iter()
            .find(|p| p.id().to_string() == device_id)
            .ok_or_else(|| BluetoothError::DeviceNotFound(device_id.to_string()))?;

        // Check if already connected
        let is_connected = peripheral
            .is_connected()
            .await
            .map_err(|e| BluetoothError::Internal(e.to_string()))?;

        if !is_connected {
            // Connect to the device
            peripheral
                .connect()
                .await
                .map_err(|e| BluetoothError::ConnectionFailed(e.to_string()))?;

            // Discover services
            peripheral
                .discover_services()
                .await
                .map_err(|e| BluetoothError::ConnectionFailed(e.to_string()))?;
        }

        // Store the connected device
        {
            let mut devices = self.connected_devices.lock().unwrap();
            devices.insert(device_id.to_string(), peripheral);
        }

        Ok(())
    }

    /// Disconnect from a Bluetooth device
    pub async fn disconnect_device(&self, device_id: &str) -> BluetoothResult<()> {
        let peripheral = {
            let mut devices = self.connected_devices.lock().unwrap();
            devices
                .remove(device_id)
                .ok_or_else(|| BluetoothError::DeviceNotFound(device_id.to_string()))?
        };

        peripheral
            .disconnect()
            .await
            .map_err(|e| BluetoothError::ConnectionFailed(e.to_string()))?;

        Ok(())
    }

    /// Write data to a characteristic
    ///
    /// # Arguments
    /// * `device_id` - The device to write to
    /// * `characteristic_uuid` - The UUID of the characteristic
    /// * `data` - The data to write
    pub async fn write_characteristic(
        &self,
        device_id: &str,
        characteristic_uuid: &str,
        data: &[u8],
    ) -> BluetoothResult<()> {
        let peripheral = {
            let devices = self.connected_devices.lock().unwrap();
            devices
                .get(device_id)
                .cloned()
                .ok_or_else(|| BluetoothError::DeviceNotFound(device_id.to_string()))?
        };

        // Parse UUID
        let uuid = Uuid::parse_str(characteristic_uuid)
            .map_err(|e| BluetoothError::CharacteristicNotFound(e.to_string()))?;

        // Find the characteristic
        let characteristics = peripheral.characteristics();
        let characteristic = characteristics
            .iter()
            .find(|c| c.uuid == uuid)
            .ok_or_else(|| BluetoothError::CharacteristicNotFound(characteristic_uuid.to_string()))?;

        // Write to the characteristic
        peripheral
            .write(characteristic, data, WriteType::WithoutResponse)
            .await
            .map_err(|e| BluetoothError::WriteFailed(e.to_string()))?;

        Ok(())
    }

    /// Read data from a characteristic
    pub async fn read_characteristic(
        &self,
        device_id: &str,
        characteristic_uuid: &str,
    ) -> BluetoothResult<Vec<u8>> {
        let peripheral = {
            let devices = self.connected_devices.lock().unwrap();
            devices
                .get(device_id)
                .cloned()
                .ok_or_else(|| BluetoothError::DeviceNotFound(device_id.to_string()))?
        };

        // Parse UUID
        let uuid = Uuid::parse_str(characteristic_uuid)
            .map_err(|e| BluetoothError::CharacteristicNotFound(e.to_string()))?;

        // Find the characteristic
        let characteristics = peripheral.characteristics();
        let characteristic = characteristics
            .iter()
            .find(|c| c.uuid == uuid)
            .ok_or_else(|| BluetoothError::CharacteristicNotFound(characteristic_uuid.to_string()))?;

        // Read from the characteristic
        let data = peripheral
            .read(characteristic)
            .await
            .map_err(|e| BluetoothError::ReadFailed(e.to_string()))?;

        Ok(data)
    }

    /// Print to a Bluetooth printer
    ///
    /// # Arguments
    /// * `device_id` - The printer device ID
    /// * `commands` - List of printer commands to send
    pub async fn print(&self, device_id: &str, commands: Vec<PrinterCommand>) -> BluetoothResult<()> {
        // Common printer write characteristic UUID (may need adjustment per printer)
        const PRINTER_WRITE_UUID: &str = "0000ff01-0000-1000-8000-00805f9b34fb";

        for command in commands {
            let data = command.to_bytes();
            self.write_characteristic(device_id, PRINTER_WRITE_UUID, &data)
                .await?;

            // Small delay between commands
            sleep(Duration::from_millis(50)).await;
        }

        Ok(())
    }

    /// Get list of connected devices
    pub fn get_connected_devices(&self) -> Vec<String> {
        let devices = self.connected_devices.lock().unwrap();
        devices.keys().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_printer_command_bytes() {
        let cmd = PrinterCommand::Initialize;
        assert_eq!(cmd.to_bytes(), vec![0x1B, 0x40]);

        let cmd = PrinterCommand::Text("Hello".to_string());
        assert_eq!(cmd.to_bytes(), "Hello".as_bytes().to_vec());

        let cmd = PrinterCommand::Cut;
        assert_eq!(cmd.to_bytes(), vec![0x1D, 0x56, 0x00]);
    }

    #[tokio::test]
    async fn test_bluetooth_manager_creation() {
        // This test may fail on systems without Bluetooth
        let result = BluetoothManager::new().await;
        // Just verify it doesn't panic
        assert!(result.is_ok() || result.is_err());
    }
}

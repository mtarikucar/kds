use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use crate::hardware::errors::HardwareResult;

/// Connection type enum
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ConnectionType {
    Serial,
    Network,
    UsbHid,
    Bluetooth,
}

/// Connection configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ConnectionConfig {
    Serial {
        port: String,
        baud_rate: u32,
        data_bits: Option<u8>,
        stop_bits: Option<u8>,
        parity: Option<String>,
        timeout_ms: Option<u64>,
    },
    Network {
        host: String,
        port: u16,
        protocol: NetworkProtocol,
        timeout_ms: Option<u64>,
    },
    UsbHid {
        vendor_id: u16,
        product_id: u16,
        serial_number: Option<String>,
    },
    Bluetooth {
        device_address: String,
        device_name: Option<String>,
        service_uuid: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NetworkProtocol {
    Tcp,
    Udp,
}

/// Base trait for all connection types
#[async_trait]
pub trait Connection: Send + Sync {
    /// Connect to the device
    async fn connect(&mut self) -> HardwareResult<()>;

    /// Disconnect from the device
    async fn disconnect(&mut self) -> HardwareResult<()>;

    /// Check if currently connected
    fn is_connected(&self) -> bool;

    /// Send data to the device
    async fn send(&mut self, data: &[u8]) -> HardwareResult<usize>;

    /// Receive data from the device
    async fn receive(&mut self, buffer: &mut [u8]) -> HardwareResult<usize>;

    /// Send data and wait for response
    async fn send_and_receive(
        &mut self,
        data: &[u8],
        buffer: &mut [u8],
    ) -> HardwareResult<usize> {
        self.send(data).await?;
        self.receive(buffer).await
    }

    /// Flush any pending data
    async fn flush(&mut self) -> HardwareResult<()>;

    /// Get connection type
    fn connection_type(&self) -> ConnectionType;

    /// Get connection info as string
    fn connection_info(&self) -> String;
}

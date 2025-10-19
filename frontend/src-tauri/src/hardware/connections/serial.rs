use async_trait::async_trait;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_serial::{SerialPort, SerialPortBuilderExt, SerialStream};
use crate::hardware::errors::{HardwareError, HardwareResult};
use super::connection::{Connection, ConnectionType};

use std::sync::Arc;
use tokio::sync::Mutex;

pub struct SerialConnection {
    port_name: String,
    baud_rate: u32,
    timeout_ms: u64,
    stream: Option<Arc<Mutex<SerialStream>>>,
}

impl SerialConnection {
    pub fn new(port_name: String, baud_rate: u32, timeout_ms: Option<u64>) -> Self {
        Self {
            port_name,
            baud_rate,
            timeout_ms: timeout_ms.unwrap_or(1000),
            stream: None,
        }
    }

    pub fn from_config(port: String, baud_rate: u32, timeout_ms: Option<u64>) -> Self {
        Self::new(port, baud_rate, timeout_ms)
    }
}

#[async_trait]
impl Connection for SerialConnection {
    async fn connect(&mut self) -> HardwareResult<()> {
        if self.is_connected() {
            return Ok(());
        }

        let stream = tokio_serial::new(&self.port_name, self.baud_rate)
            .timeout(std::time::Duration::from_millis(self.timeout_ms))
            .open_native_async()
            .map_err(|e| HardwareError::ConnectionError(format!(
                "Failed to open serial port {}: {}",
                self.port_name, e
            )))?;

        self.stream = Some(Arc::new(Mutex::new(stream)));
        tracing::info!("Serial connection established on {}", self.port_name);
        Ok(())
    }

    async fn disconnect(&mut self) -> HardwareResult<()> {
        if let Some(stream_arc) = self.stream.take() {
            let mut stream = stream_arc.lock().await;
            stream.flush().await?;
            tracing::info!("Serial connection closed on {}", self.port_name);
        }
        Ok(())
    }

    fn is_connected(&self) -> bool {
        self.stream.is_some()
    }

    async fn send(&mut self, data: &[u8]) -> HardwareResult<usize> {
        let stream_arc = self.stream.as_ref()
            .ok_or_else(|| HardwareError::ConnectionError("Not connected".to_string()))?;

        let mut stream = stream_arc.lock().await;
        let written = stream.write(data).await?;
        stream.flush().await?;

        tracing::debug!("Sent {} bytes to serial port {}", written, self.port_name);
        Ok(written)
    }

    async fn receive(&mut self, buffer: &mut [u8]) -> HardwareResult<usize> {
        let stream_arc = self.stream.as_ref()
            .ok_or_else(|| HardwareError::ConnectionError("Not connected".to_string()))?;

        let mut stream = stream_arc.lock().await;
        let timeout = tokio::time::Duration::from_millis(self.timeout_ms);
        let read_future = stream.read(buffer);

        match tokio::time::timeout(timeout, read_future).await {
            Ok(Ok(bytes_read)) => {
                tracing::debug!("Received {} bytes from serial port {}", bytes_read, self.port_name);
                Ok(bytes_read)
            }
            Ok(Err(e)) => Err(HardwareError::IoError(e)),
            Err(_) => Err(HardwareError::Timeout(format!(
                "Read timeout on serial port {}",
                self.port_name
            ))),
        }
    }

    async fn flush(&mut self) -> HardwareResult<()> {
        if let Some(stream_arc) = &self.stream {
            let mut stream = stream_arc.lock().await;
            stream.flush().await?;
        }
        Ok(())
    }

    fn connection_type(&self) -> ConnectionType {
        ConnectionType::Serial
    }

    fn connection_info(&self) -> String {
        format!("Serial: {} @ {} baud", self.port_name, self.baud_rate)
    }
}

impl Drop for SerialConnection {
    fn drop(&mut self) {
        if self.stream.is_some() {
            tracing::debug!("Dropping serial connection on {}", self.port_name);
        }
    }
}

/// Helper function to list available serial ports
pub fn list_serial_ports() -> HardwareResult<Vec<String>> {
    let ports = serialport::available_ports()
        .map_err(|e| HardwareError::ConnectionError(format!("Failed to list ports: {}", e)))?;

    Ok(ports.iter().map(|p| p.port_name.clone()).collect())
}

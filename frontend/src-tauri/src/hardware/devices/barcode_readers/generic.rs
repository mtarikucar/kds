use async_trait::async_trait;
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::hardware::errors::{HardwareError, HardwareResult};
use crate::hardware::traits::{
    HardwareDevice, BarcodeReaderDevice, DeviceStatus, DeviceType,
    ConnectionStatus, HealthStatus, BarcodeScanResult, ScanMode,
};
use crate::hardware::connections::Connection;
use crate::hardware::events::HardwareEventEmitter;

/// Generic barcode/QR code reader
pub struct GenericBarcodeReader {
    id: String,
    name: String,
    connection: Arc<Mutex<Box<dyn Connection>>>,
    last_activity: Arc<Mutex<Option<chrono::DateTime<chrono::Utc>>>>,
    last_scan: Arc<Mutex<Option<BarcodeScanResult>>>,
    scanning: Arc<Mutex<bool>>,
    beep_enabled: Arc<Mutex<bool>>,
    event_emitter: Option<HardwareEventEmitter>,
}

impl GenericBarcodeReader {
    pub fn new(
        id: String,
        name: String,
        connection: Box<dyn Connection>,
    ) -> Self {
        Self {
            id,
            name,
            connection: Arc::new(Mutex::new(connection)),
            last_activity: Arc::new(Mutex::new(None)),
            last_scan: Arc::new(Mutex::new(None)),
            scanning: Arc::new(Mutex::new(false)),
            beep_enabled: Arc::new(Mutex::new(true)),
            event_emitter: None,
        }
    }

    pub fn with_event_emitter(mut self, emitter: HardwareEventEmitter) -> Self {
        self.event_emitter = Some(emitter);
        self
    }

    async fn send_command(&self, command: &[u8]) -> HardwareResult<()> {
        let mut conn = self.connection.lock().await;
        conn.send(command).await?;
        *self.last_activity.lock().await = Some(chrono::Utc::now());
        Ok(())
    }

    async fn read_scan_data(&self) -> HardwareResult<Option<String>> {
        let mut conn = self.connection.lock().await;
        let mut buffer = vec![0u8; 256];

        match conn.receive(&mut buffer).await {
            Ok(bytes_read) if bytes_read > 0 => {
                let data = String::from_utf8_lossy(&buffer[..bytes_read])
                    .trim()
                    .to_string();
                Ok(Some(data))
            }
            Ok(_) => Ok(None),
            Err(HardwareError::Timeout(_)) => Ok(None),
            Err(e) => Err(e),
        }
    }

    // Scanner commands (varies by manufacturer)
    fn cmd_enable_continuous() -> &'static [u8] { b"SCNENA\r" }
    fn cmd_disable_scanning() -> &'static [u8] { b"SCNDIS\r" }
    fn cmd_trigger_scan() -> &'static [u8] { b"SCNTRG\r" }
    fn cmd_beep_on() -> &'static [u8] { b"BEPEN1\r" }
    fn cmd_beep_off() -> &'static [u8] { b"BEPEN0\r" }
}

#[async_trait]
impl HardwareDevice for GenericBarcodeReader {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn device_type(&self) -> DeviceType {
        DeviceType::BarcodeReader
    }

    async fn connect(&mut self) -> HardwareResult<()> {
        let mut conn = self.connection.lock().await;
        conn.connect().await?;
        tracing::info!("Barcode reader {} connected", self.name);
        Ok(())
    }

    async fn disconnect(&mut self) -> HardwareResult<()> {
        // Stop scanning first
        *self.scanning.lock().await = false;

        let mut conn = self.connection.lock().await;
        conn.disconnect().await?;
        tracing::info!("Barcode reader {} disconnected", self.name);
        Ok(())
    }

    fn is_connected(&self) -> bool {
        true // Placeholder
    }

    async fn get_status(&self) -> HardwareResult<DeviceStatus> {
        let conn = self.connection.lock().await;
        let last_activity = *self.last_activity.lock().await;

        Ok(DeviceStatus {
            id: self.id.clone(),
            name: self.name.clone(),
            device_type: DeviceType::BarcodeReader,
            connection_status: if conn.is_connected() {
                ConnectionStatus::Connected
            } else {
                ConnectionStatus::Disconnected
            },
            health: HealthStatus::Healthy,
            last_activity,
            error_message: None,
        })
    }

    async fn health_check(&mut self) -> HardwareResult<HealthStatus> {
        if self.is_connected() {
            Ok(HealthStatus::Healthy)
        } else {
            Ok(HealthStatus::Error)
        }
    }

    async fn reset(&mut self) -> HardwareResult<()> {
        self.stop_scanning().await?;
        *self.last_scan.lock().await = None;
        Ok(())
    }

    fn capabilities(&self) -> serde_json::Value {
        serde_json::json!({
            "features": [
                "barcode_scanning",
                "qr_code_scanning",
                "continuous_mode",
                "manual_trigger"
            ],
            "supported_types": self.supported_barcode_types()
        })
    }
}

#[async_trait]
impl BarcodeReaderDevice for GenericBarcodeReader {
    async fn start_scanning(&mut self, mode: ScanMode) -> HardwareResult<()> {
        match mode {
            ScanMode::Continuous => {
                self.send_command(Self::cmd_enable_continuous()).await?;
            }
            ScanMode::SingleShot | ScanMode::Manual => {
                // Manual mode, wait for trigger
            }
        }

        *self.scanning.lock().await = true;

        // Start background task to read scans
        if matches!(mode, ScanMode::Continuous) {
            let id = self.id.clone();
            let connection = Arc::clone(&self.connection);
            let last_scan = Arc::clone(&self.last_scan);
            let scanning = Arc::clone(&self.scanning);
            let event_emitter = self.event_emitter.clone();

            tokio::spawn(async move {
                let mut buffer = vec![0u8; 256];

                while *scanning.lock().await {
                    let mut conn = connection.lock().await;

                    match conn.receive(&mut buffer).await {
                        Ok(bytes_read) if bytes_read > 0 => {
                            let data = String::from_utf8_lossy(&buffer[..bytes_read])
                                .trim()
                                .to_string();

                            if !data.is_empty() {
                                let result = BarcodeScanResult {
                                    data: data.clone(),
                                    barcode_type: "Unknown".to_string(),
                                    timestamp: chrono::Utc::now(),
                                    quality: None,
                                };

                                *last_scan.lock().await = Some(result.clone());

                                // Emit event
                                if let Some(emitter) = &event_emitter {
                                    emitter.emit_barcode_scanned(
                                        id.clone(),
                                        data,
                                        "Unknown".to_string(),
                                    );
                                }

                                tracing::info!("Barcode scanned: {}", result.data);
                            }
                        }
                        _ => {
                            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                        }
                    }
                }
            });
        }

        tracing::info!("Barcode reader {} started in {:?} mode", self.name, mode);
        Ok(())
    }

    async fn stop_scanning(&mut self) -> HardwareResult<()> {
        *self.scanning.lock().await = false;
        self.send_command(Self::cmd_disable_scanning()).await?;
        tracing::info!("Barcode reader {} stopped scanning", self.name);
        Ok(())
    }

    async fn trigger_scan(&mut self) -> HardwareResult<Option<BarcodeScanResult>> {
        self.send_command(Self::cmd_trigger_scan()).await?;

        // Wait for scan result (with timeout)
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

        if let Some(data) = self.read_scan_data().await? {
            let result = BarcodeScanResult {
                data: data.clone(),
                barcode_type: "Unknown".to_string(),
                timestamp: chrono::Utc::now(),
                quality: None,
            };

            *self.last_scan.lock().await = Some(result.clone());

            // Emit event
            if let Some(emitter) = &self.event_emitter {
                emitter.emit_barcode_scanned(
                    self.id.clone(),
                    data,
                    "Unknown".to_string(),
                );
            }

            return Ok(Some(result));
        }

        Ok(None)
    }

    async fn get_last_scan(&self) -> HardwareResult<Option<BarcodeScanResult>> {
        Ok(self.last_scan.lock().await.clone())
    }

    async fn configure(&mut self, _config: serde_json::Value) -> HardwareResult<()> {
        // Implementation depends on specific scanner
        Ok(())
    }

    async fn set_beep_enabled(&mut self, enabled: bool) -> HardwareResult<()> {
        let cmd = if enabled {
            Self::cmd_beep_on()
        } else {
            Self::cmd_beep_off()
        };

        self.send_command(cmd).await?;
        *self.beep_enabled.lock().await = enabled;

        tracing::info!("Barcode reader {} beep {}", self.name, if enabled { "enabled" } else { "disabled" });
        Ok(())
    }

    fn supported_barcode_types(&self) -> Vec<String> {
        vec![
            "Code128".to_string(),
            "Code39".to_string(),
            "EAN13".to_string(),
            "EAN8".to_string(),
            "UPCA".to_string(),
            "UPCE".to_string(),
            "QRCode".to_string(),
            "DataMatrix".to_string(),
        ]
    }
}

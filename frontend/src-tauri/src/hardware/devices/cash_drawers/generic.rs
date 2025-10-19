use async_trait::async_trait;
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::hardware::errors::{HardwareError, HardwareResult};
use crate::hardware::traits::{
    HardwareDevice, CashDrawerDevice, DeviceStatus, DeviceType,
    ConnectionStatus, HealthStatus, DrawerStatus,
};
use crate::hardware::connections::Connection;

/// Generic cash drawer device (typically connected via printer or serial)
pub struct GenericCashDrawer {
    id: String,
    name: String,
    connection: Arc<Mutex<Box<dyn Connection>>>,
    last_activity: Arc<Mutex<Option<chrono::DateTime<chrono::Utc>>>>,
    drawer_open_time: Arc<Mutex<Option<chrono::DateTime<chrono::Utc>>>>,
}

impl GenericCashDrawer {
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
            drawer_open_time: Arc::new(Mutex::new(None)),
        }
    }

    async fn send_command(&self, command: &[u8]) -> HardwareResult<()> {
        let mut conn = self.connection.lock().await;
        conn.send(command).await?;
        *self.last_activity.lock().await = Some(chrono::Utc::now());
        Ok(())
    }

    // ESC/POS cash drawer pulse command
    fn cmd_open_drawer() -> &'static [u8] {
        &[0x1B, 0x70, 0x00, 0x19, 0xFA]
    }

    // Alternative drawer command for some models
    fn cmd_open_drawer_alt() -> &'static [u8] {
        &[0x1B, 0x70, 0x01, 0x19, 0xFA]
    }
}

#[async_trait]
impl HardwareDevice for GenericCashDrawer {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn device_type(&self) -> DeviceType {
        DeviceType::CashDrawer
    }

    async fn connect(&mut self) -> HardwareResult<()> {
        let mut conn = self.connection.lock().await;
        conn.connect().await?;
        tracing::info!("Cash drawer {} connected", self.name);
        Ok(())
    }

    async fn disconnect(&mut self) -> HardwareResult<()> {
        let mut conn = self.connection.lock().await;
        conn.disconnect().await?;
        tracing::info!("Cash drawer {} disconnected", self.name);
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
            device_type: DeviceType::CashDrawer,
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
        // Cash drawers don't typically have reset commands
        Ok(())
    }

    fn capabilities(&self) -> serde_json::Value {
        serde_json::json!({
            "features": [
                "open_drawer",
                "status_check"
            ],
            "protocol": "ESC/POS Cash Drawer Pulse"
        })
    }
}

#[async_trait]
impl CashDrawerDevice for GenericCashDrawer {
    async fn open(&mut self) -> HardwareResult<()> {
        self.send_command(Self::cmd_open_drawer()).await?;
        *self.drawer_open_time.lock().await = Some(chrono::Utc::now());
        tracing::info!("Cash drawer {} opened", self.name);
        Ok(())
    }

    async fn get_drawer_status(&mut self) -> HardwareResult<DrawerStatus> {
        // Most cash drawers don't provide status feedback
        // Would need specialized hardware with status pins
        let drawer_open_time = *self.drawer_open_time.lock().await;

        if let Some(open_time) = drawer_open_time {
            let elapsed = chrono::Utc::now().signed_duration_since(open_time);
            // Assume drawer closes within 30 seconds
            if elapsed.num_seconds() < 30 {
                return Ok(DrawerStatus::Open);
            }
        }

        Ok(DrawerStatus::Closed)
    }

    async fn wait_for_close(&mut self, timeout_secs: u64) -> HardwareResult<bool> {
        let start = chrono::Utc::now();
        let timeout = chrono::Duration::seconds(timeout_secs as i64);

        loop {
            let status = self.get_drawer_status().await?;
            if status == DrawerStatus::Closed {
                return Ok(true);
            }

            let elapsed = chrono::Utc::now().signed_duration_since(start);
            if elapsed > timeout {
                return Ok(false);
            }

            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
        }
    }

    async fn enable_open_alert(&mut self, _enable: bool) -> HardwareResult<()> {
        // Not supported on generic cash drawers
        Err(HardwareError::UnsupportedOperation(
            "Open alert not supported on this device".to_string()
        ))
    }
}

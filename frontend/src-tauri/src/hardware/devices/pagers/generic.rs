use async_trait::async_trait;
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::hardware::errors::{HardwareError, HardwareResult};
use crate::hardware::traits::{
    HardwareDevice, PagerDevice, DeviceStatus, DeviceType,
    ConnectionStatus, HealthStatus, PagerMessage, PagerCallType,
};
use crate::hardware::connections::Connection;

/// Generic restaurant pager system
/// This is a basic implementation that can be extended for specific systems (LRS, Retekess, etc.)
pub struct GenericPager {
    id: String,
    name: String,
    connection: Arc<Mutex<Box<dyn Connection>>>,
    last_activity: Arc<Mutex<Option<chrono::DateTime<chrono::Utc>>>>,
    active_pagers: Arc<Mutex<std::collections::HashSet<u16>>>,
}

impl GenericPager {
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
            active_pagers: Arc::new(Mutex::new(std::collections::HashSet::new())),
        }
    }

    async fn send_command(&self, command: &[u8]) -> HardwareResult<()> {
        let mut conn = self.connection.lock().await;
        conn.send(command).await?;
        *self.last_activity.lock().await = Some(chrono::Utc::now());
        Ok(())
    }

    // Generic pager protocol (customize for specific systems)
    fn build_call_command(pager_number: u16, call_type: &PagerCallType) -> Vec<u8> {
        let call_type_byte = match call_type {
            PagerCallType::Beep => 0x01,
            PagerCallType::Vibrate => 0x02,
            PagerCallType::BeepAndVibrate => 0x03,
            PagerCallType::Flash => 0x04,
            PagerCallType::Custom(_) => 0x05,
        };

        vec![
            0x02, // STX
            (pager_number >> 8) as u8,
            (pager_number & 0xFF) as u8,
            call_type_byte,
            0x03, // ETX
        ]
    }
}

#[async_trait]
impl HardwareDevice for GenericPager {
    fn id(&self) -> &str {
        &self.id
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn device_type(&self) -> DeviceType {
        DeviceType::RestaurantPager
    }

    async fn connect(&mut self) -> HardwareResult<()> {
        let mut conn = self.connection.lock().await;
        conn.connect().await?;
        tracing::info!("Pager system {} connected", self.name);
        Ok(())
    }

    async fn disconnect(&mut self) -> HardwareResult<()> {
        let mut conn = self.connection.lock().await;
        conn.disconnect().await?;
        tracing::info!("Pager system {} disconnected", self.name);
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
            device_type: DeviceType::RestaurantPager,
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
        self.active_pagers.lock().await.clear();
        Ok(())
    }

    fn capabilities(&self) -> serde_json::Value {
        serde_json::json!({
            "features": [
                "call_pager",
                "cancel_pager",
                "range_check"
            ],
            "max_pager_number": 999,
            "supported_call_types": ["beep", "vibrate", "beep_and_vibrate", "flash"]
        })
    }
}

#[async_trait]
impl PagerDevice for GenericPager {
    async fn call_pager(&mut self, message: &PagerMessage) -> HardwareResult<()> {
        let command = Self::build_call_command(message.pager_number, &message.call_type);
        self.send_command(&command).await?;

        let mut active = self.active_pagers.lock().await;
        active.insert(message.pager_number);

        tracing::info!(
            "Pager {} called via system {}",
            message.pager_number,
            self.name
        );
        Ok(())
    }

    async fn cancel_pager(&mut self, pager_number: u16) -> HardwareResult<()> {
        // Send cancel command (protocol specific)
        let command = vec![
            0x02, // STX
            (pager_number >> 8) as u8,
            (pager_number & 0xFF) as u8,
            0x00, // Cancel
            0x03, // ETX
        ];

        self.send_command(&command).await?;

        let mut active = self.active_pagers.lock().await;
        active.remove(&pager_number);

        tracing::info!("Pager {} cancelled", pager_number);
        Ok(())
    }

    async fn check_pager_in_range(&mut self, pager_number: u16) -> HardwareResult<bool> {
        // This would require sending a ping command and waiting for response
        // For now, return true if recently called
        let active = self.active_pagers.lock().await;
        Ok(active.contains(&pager_number))
    }

    async fn list_pagers_in_range(&mut self) -> HardwareResult<Vec<u16>> {
        let active = self.active_pagers.lock().await;
        Ok(active.iter().copied().collect())
    }

    async fn configure_base_station(&mut self, _config: serde_json::Value) -> HardwareResult<()> {
        // Implementation depends on specific pager system
        Err(HardwareError::UnsupportedOperation(
            "Base station configuration not implemented for generic pager".to_string()
        ))
    }

    async fn get_pager_battery(&mut self, _pager_number: u16) -> HardwareResult<Option<u8>> {
        // Not supported on most basic pager systems
        Ok(None)
    }
}

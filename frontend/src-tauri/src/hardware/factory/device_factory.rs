use crate::hardware::errors::{HardwareError, HardwareResult};
use crate::hardware::traits::{HardwareDevice, DeviceType};
use crate::hardware::config::DeviceConfig;
use crate::hardware::devices::{
    EscPosPrinter, GenericCashDrawer, GenericPager, GenericBarcodeReader,
};
use crate::hardware::events::HardwareEventEmitter;
use super::connection_factory::ConnectionFactory;

/// Factory for creating device instances
pub struct DeviceFactory {
    event_emitter: Option<HardwareEventEmitter>,
}

impl DeviceFactory {
    pub fn new() -> Self {
        Self {
            event_emitter: None,
        }
    }

    pub fn with_event_emitter(mut self, emitter: HardwareEventEmitter) -> Self {
        self.event_emitter = Some(emitter);
        self
    }

    /// Create a device from configuration
    pub fn create(&self, config: &DeviceConfig) -> HardwareResult<Box<dyn HardwareDevice>> {
        if !config.enabled {
            return Err(HardwareError::InvalidConfiguration(
                format!("Device {} is disabled", config.id)
            ));
        }

        // Validate connection config
        ConnectionFactory::validate(&config.connection)?;

        // Store connection info before creating device
        let connection_info = format!("{:?}", config.connection);

        // Create device based on type
        let device: Box<dyn HardwareDevice> = match config.device_type {
            DeviceType::ThermalPrinter => {
                let connection = ConnectionFactory::create(&config.connection)?;
                Box::new(EscPosPrinter::new(
                    config.id.clone(),
                    config.name.clone(),
                    connection,
                ))
            }

            DeviceType::CashDrawer => {
                let connection = ConnectionFactory::create(&config.connection)?;
                Box::new(GenericCashDrawer::new(
                    config.id.clone(),
                    config.name.clone(),
                    connection,
                ))
            }

            DeviceType::RestaurantPager => {
                let connection = ConnectionFactory::create(&config.connection)?;
                Box::new(GenericPager::new(
                    config.id.clone(),
                    config.name.clone(),
                    connection,
                ))
            }

            DeviceType::BarcodeReader => {
                let connection = ConnectionFactory::create(&config.connection)?;
                let reader = GenericBarcodeReader::new(
                    config.id.clone(),
                    config.name.clone(),
                    connection,
                );

                // Add event emitter if available
                if let Some(emitter) = &self.event_emitter {
                    Box::new(reader.with_event_emitter(emitter.clone()))
                } else {
                    Box::new(reader)
                }
            }

            DeviceType::CustomerDisplay |
            DeviceType::KitchenDisplay |
            DeviceType::ScaleDevice |
            DeviceType::Other(_) => {
                return Err(HardwareError::UnsupportedOperation(
                    format!("Device type {:?} not yet implemented", config.device_type)
                ));
            }
        };

        tracing::info!(
            "Created device: {} ({:?}) via {}",
            config.name,
            config.device_type,
            connection_info
        );

        Ok(device)
    }

    /// Create multiple devices from a list of configurations
    pub fn create_multiple(
        &self,
        configs: &[DeviceConfig],
    ) -> Vec<(DeviceConfig, HardwareResult<Box<dyn HardwareDevice>>)> {
        configs
            .iter()
            .map(|config| {
                let result = self.create(config);
                (config.clone(), result)
            })
            .collect()
    }

    /// Create and auto-connect devices
    pub async fn create_and_connect(
        &self,
        config: &DeviceConfig,
    ) -> HardwareResult<Box<dyn HardwareDevice>> {
        let mut device = self.create(config)?;

        if config.auto_connect {
            device.connect().await?;

            // Emit connection event
            if let Some(emitter) = &self.event_emitter {
                emitter.emit_device_connected(
                    config.id.clone(),
                    config.name.clone(),
                );
            }
        }

        Ok(device)
    }
}

impl Default for DeviceFactory {
    fn default() -> Self {
        Self::new()
    }
}

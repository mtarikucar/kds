use std::sync::Arc;
use tokio::sync::RwLock;
use crate::hardware::errors::{HardwareError, HardwareResult};
use crate::hardware::config::{DeviceRegistry, HardwareConfig, GlobalHardwareSettings};
use crate::hardware::factory::DeviceFactory;
use crate::hardware::api::BackendClient;
use crate::hardware::events::HardwareEventEmitter;
use crate::hardware::traits::{DeviceStatus, HardwareDevice, PrinterDevice, ReceiptData, KitchenOrderData};

/// Central hardware management system
pub struct HardwareManager {
    registry: DeviceRegistry,
    factory: Arc<DeviceFactory>,
    backend_client: Option<Arc<BackendClient>>,
    event_emitter: HardwareEventEmitter,
    global_settings: Arc<RwLock<GlobalHardwareSettings>>,
}

impl HardwareManager {
    pub fn new(event_emitter: HardwareEventEmitter) -> Self {
        let factory = DeviceFactory::new().with_event_emitter(event_emitter.clone());

        Self {
            registry: DeviceRegistry::new(),
            factory: Arc::new(factory),
            backend_client: None,
            event_emitter,
            global_settings: Arc::new(RwLock::new(GlobalHardwareSettings::default())),
        }
    }

    pub fn with_backend_client(mut self, base_url: String) -> Self {
        self.backend_client = Some(Arc::new(BackendClient::new(base_url)));
        self
    }

    /// Initialize hardware from backend API
    pub async fn initialize_from_backend(&mut self) -> HardwareResult<()> {
        let backend = self.backend_client.as_ref()
            .ok_or_else(|| HardwareError::InitializationError(
                "Backend client not configured".to_string()
            ))?;

        tracing::info!("Initializing hardware from backend...");

        // Fetch configuration
        let config = backend.fetch_hardware_config().await?;

        // Update global settings
        *self.global_settings.write().await = config.global_settings.clone();

        // Initialize devices
        self.initialize_from_config(&config).await?;

        tracing::info!(
            "Hardware initialization complete: {} devices registered",
            self.registry.device_count().await
        );

        Ok(())
    }

    /// Initialize hardware from configuration
    pub async fn initialize_from_config(&mut self, config: &HardwareConfig) -> HardwareResult<()> {
        let enabled_devices: Vec<_> = config.enabled_devices()
            .into_iter()
            .cloned()
            .collect();

        tracing::info!("Initializing {} enabled devices", enabled_devices.len());

        for device_config in enabled_devices {
            match self.factory.create_and_connect(&device_config).await {
                Ok(device) => {
                    if let Err(e) = self.registry.register(device).await {
                        tracing::error!(
                            "Failed to register device {}: {}",
                            device_config.id,
                            e
                        );
                        self.event_emitter.emit_device_error(
                            device_config.id.clone(),
                            device_config.name.clone(),
                            e.to_string(),
                        );
                    }
                }
                Err(e) => {
                    tracing::error!(
                        "Failed to create/connect device {}: {}",
                        device_config.id,
                        e
                    );
                    self.event_emitter.emit_device_error(
                        device_config.id.clone(),
                        device_config.name.clone(),
                        e.to_string(),
                    );
                }
            }
        }

        // Start health check loop if enabled
        let settings = self.global_settings.read().await;
        if settings.enable_health_checks {
            self.start_health_check_loop().await;
        }

        Ok(())
    }

    /// Start periodic health check loop
    async fn start_health_check_loop(&self) {
        let registry = self.registry.clone();
        let settings = Arc::clone(&self.global_settings);
        let event_emitter = self.event_emitter.clone();

        tokio::spawn(async move {
            loop {
                let interval = {
                    let s = settings.read().await;
                    if !s.enable_health_checks {
                        break;
                    }
                    s.health_check_interval_secs
                };

                tokio::time::sleep(tokio::time::Duration::from_secs(interval)).await;

                let device_ids = registry.list_device_ids().await;
                for device_id in device_ids {
                    if let Ok(device_arc) = registry.get_device(&device_id).await {
                        let mut device = device_arc.write().await;
                        match device.health_check().await {
                            Ok(health) => {
                                tracing::debug!("Device {} health: {:?}", device_id, health);
                            }
                            Err(e) => {
                                tracing::warn!("Health check failed for {}: {}", device_id, e);
                                event_emitter.emit_device_error(
                                    device_id.clone(),
                                    device.name().to_string(),
                                    e.to_string(),
                                );
                            }
                        }
                    }
                }
            }
        });

        tracing::info!("Health check loop started");
    }

    /// Get all device statuses
    pub async fn get_all_device_statuses(&self) -> Vec<DeviceStatus> {
        self.registry.get_all_statuses().await
    }

    /// Get status of a specific device
    pub async fn get_device_status(&self, device_id: &str) -> HardwareResult<DeviceStatus> {
        self.registry.get_device_status(device_id).await
    }

    /// Check if device exists
    pub async fn has_device(&self, device_id: &str) -> bool {
        self.registry.has_device(device_id).await
    }

    /// Print receipt on a specific printer
    pub async fn print_receipt(
        &self,
        device_id: &str,
        receipt: &ReceiptData,
    ) -> HardwareResult<()> {
        let device_arc = self.registry.get_device(device_id).await?;
        let mut device = device_arc.write().await;

        // Downcast to PrinterDevice
        let printer = device.as_any_mut()
            .downcast_mut::<Box<dyn PrinterDevice>>()
            .ok_or_else(|| HardwareError::UnsupportedOperation(
                format!("Device {} is not a printer", device_id)
            ))?;

        printer.print_receipt(receipt).await?;

        self.event_emitter.emit_print_completed(device_id.to_string(), Some(receipt.order_id.clone()));

        Ok(())
    }

    /// Print kitchen order on a specific printer
    pub async fn print_kitchen_order(
        &self,
        device_id: &str,
        order: &KitchenOrderData,
    ) -> HardwareResult<()> {
        let device_arc = self.registry.get_device(device_id).await?;
        let mut device = device_arc.write().await;

        // Downcast to PrinterDevice
        let printer = device.as_any_mut()
            .downcast_mut::<Box<dyn PrinterDevice>>()
            .ok_or_else(|| HardwareError::UnsupportedOperation(
                format!("Device {} is not a printer", device_id)
            ))?;

        printer.print_kitchen_order(order).await?;

        self.event_emitter.emit_print_completed(device_id.to_string(), Some(order.order_id.clone()));

        Ok(())
    }

    /// Execute a generic operation on a device
    pub async fn execute_device_operation<F, R>(
        &self,
        device_id: &str,
        operation: F,
    ) -> HardwareResult<R>
    where
        F: FnOnce(&mut Box<dyn HardwareDevice>) -> std::pin::Pin<Box<dyn std::future::Future<Output = HardwareResult<R>> + '_>>,
    {
        self.registry.with_device(device_id, operation).await
    }

    /// Disconnect all devices and cleanup
    pub async fn shutdown(&self) -> HardwareResult<()> {
        tracing::info!("Shutting down hardware manager...");
        self.registry.clear().await?;
        tracing::info!("Hardware manager shutdown complete");
        Ok(())
    }

    /// Reconnect a specific device
    pub async fn reconnect_device(&self, device_id: &str) -> HardwareResult<()> {
        let device_arc = self.registry.get_device(device_id).await?;
        let mut device = device_arc.write().await;

        tracing::info!("Reconnecting device {}...", device_id);

        // Disconnect first
        if let Err(e) = device.disconnect().await {
            tracing::warn!("Error during disconnect: {}", e);
        }

        // Reconnect
        device.connect().await?;

        self.event_emitter.emit_device_connected(
            device_id.to_string(),
            device.name().to_string(),
        );

        Ok(())
    }

    /// Get event emitter for direct use
    pub fn event_emitter(&self) -> &HardwareEventEmitter {
        &self.event_emitter
    }

    /// Get device count
    pub async fn device_count(&self) -> usize {
        self.registry.device_count().await
    }
}

// Add as_any methods to HardwareDevice trait
// This is a workaround for trait object downcasting
impl dyn HardwareDevice {
    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        unsafe {
            std::mem::transmute::<&mut dyn HardwareDevice, &mut dyn std::any::Any>(self)
        }
    }
}

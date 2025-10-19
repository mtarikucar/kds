use crate::hardware::errors::{HardwareError, HardwareResult};
use crate::hardware::connections::{
    Connection, ConnectionConfig, SerialConnection, NetworkConnection,
    UsbHidConnection, BluetoothConnection,
};

/// Factory for creating connection instances
pub struct ConnectionFactory;

impl ConnectionFactory {
    pub fn create(config: &ConnectionConfig) -> HardwareResult<Box<dyn Connection>> {
        match config {
            ConnectionConfig::Serial {
                port,
                baud_rate,
                timeout_ms,
                ..
            } => {
                let conn = SerialConnection::from_config(
                    port.clone(),
                    *baud_rate,
                    *timeout_ms,
                );
                Ok(Box::new(conn))
            }

            ConnectionConfig::Network {
                host,
                port,
                protocol,
                timeout_ms,
            } => {
                let conn = NetworkConnection::new(
                    host.clone(),
                    *port,
                    protocol.clone(),
                    *timeout_ms,
                );
                Ok(Box::new(conn))
            }

            ConnectionConfig::UsbHid {
                vendor_id,
                product_id,
                serial_number,
            } => {
                let conn = UsbHidConnection::new(
                    *vendor_id,
                    *product_id,
                    serial_number.clone(),
                )?;
                Ok(Box::new(conn))
            }

            ConnectionConfig::Bluetooth {
                device_address,
                device_name,
                service_uuid,
            } => {
                let conn = BluetoothConnection::new(
                    device_address.clone(),
                    device_name.clone(),
                    service_uuid.clone(),
                    None,
                );
                Ok(Box::new(conn))
            }
        }
    }

    /// Validate connection configuration
    pub fn validate(config: &ConnectionConfig) -> HardwareResult<()> {
        match config {
            ConnectionConfig::Serial { port, baud_rate, .. } => {
                if port.is_empty() {
                    return Err(HardwareError::InvalidConfiguration(
                        "Serial port name cannot be empty".to_string()
                    ));
                }
                if *baud_rate == 0 {
                    return Err(HardwareError::InvalidConfiguration(
                        "Baud rate must be greater than 0".to_string()
                    ));
                }
            }

            ConnectionConfig::Network { host, port, .. } => {
                if host.is_empty() {
                    return Err(HardwareError::InvalidConfiguration(
                        "Network host cannot be empty".to_string()
                    ));
                }
                if *port == 0 {
                    return Err(HardwareError::InvalidConfiguration(
                        "Network port must be greater than 0".to_string()
                    ));
                }
            }

            ConnectionConfig::UsbHid { vendor_id, product_id, .. } => {
                if *vendor_id == 0 || *product_id == 0 {
                    return Err(HardwareError::InvalidConfiguration(
                        "USB vendor_id and product_id must be greater than 0".to_string()
                    ));
                }
            }

            ConnectionConfig::Bluetooth { device_address, .. } => {
                if device_address.is_empty() {
                    return Err(HardwareError::InvalidConfiguration(
                        "Bluetooth device address cannot be empty".to_string()
                    ));
                }
            }
        }

        Ok(())
    }
}

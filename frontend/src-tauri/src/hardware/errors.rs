use thiserror::Error;

#[derive(Error, Debug)]
pub enum HardwareError {
    #[error("Connection error: {0}")]
    ConnectionError(String),

    #[error("Device not found: {0}")]
    DeviceNotFound(String),

    #[error("Device initialization failed: {0}")]
    InitializationError(String),

    #[error("Communication error: {0}")]
    CommunicationError(String),

    #[error("Invalid configuration: {0}")]
    InvalidConfiguration(String),

    #[error("Operation timeout: {0}")]
    Timeout(String),

    #[error("Device busy: {0}")]
    DeviceBusy(String),

    #[error("Unsupported operation: {0}")]
    UnsupportedOperation(String),

    #[error("Serial port error: {0}")]
    SerialPortError(#[from] tokio_serial::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("HTTP error: {0}")]
    HttpError(#[from] reqwest::Error),

    #[error("HID error: {0}")]
    HidError(String),

    #[error("Bluetooth error: {0}")]
    BluetoothError(String),

    #[error("Unknown error: {0}")]
    Unknown(String),
}

pub type HardwareResult<T> = Result<T, HardwareError>;

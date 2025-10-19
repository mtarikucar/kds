pub mod connection;
pub mod serial;
pub mod network;
pub mod usb_hid;
pub mod bluetooth;

// Re-export commonly used types
pub use connection::{
    Connection, ConnectionType, ConnectionConfig, NetworkProtocol
};
pub use serial::{SerialConnection, list_serial_ports};
pub use network::NetworkConnection;
pub use usb_hid::{UsbHidConnection, list_hid_devices};
pub use bluetooth::{BluetoothConnection, scan_bluetooth_devices};

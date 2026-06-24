pub mod bluetooth;
pub mod connection;
pub mod network;
pub mod serial;
pub mod usb_hid;

// Re-export commonly used types
pub use bluetooth::{scan_bluetooth_devices, BluetoothConnection};
pub use connection::{Connection, ConnectionConfig, ConnectionType, NetworkProtocol};
pub use network::NetworkConnection;
pub use serial::{list_serial_ports, SerialConnection};
pub use usb_hid::{list_hid_devices, UsbHidConnection};

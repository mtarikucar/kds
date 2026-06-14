//! Bluetooth Low Energy device management.
//!
//! ## The hardware seam
//!
//! `BluetoothManager` holds *logic* — connected-device bookkeeping, the
//! scan→connect→write flow, the print-command sequencing, the not-found and
//! duplicate-connect handling. None of that logic should require a real BLE
//! radio to test. So the radio lives behind the [`BleAdapter`] trait, which
//! speaks only in plain data (`String` device ids, `&[u8]` payloads,
//! [`ScannedDevice`] structs) — no `btleplug` types leak across the seam.
//!
//! The real radio is [`BtleplugAdapter`], a thin adapter that maps each trait
//! method onto `btleplug` calls. Tests drive the same `BluetoothManager`
//! against an in-memory fake adapter (`tests::FakeAdapter`), so the manager's
//! logic is exercised deterministically with zero hardware.
//!
//! Production behavior is unchanged: [`BluetoothManager::new`] wires up the
//! real `BtleplugAdapter` exactly as before.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use thiserror::Error;
use tokio::time::sleep;

/// Bluetooth error types
#[derive(Error, Debug)]
pub enum BluetoothError {
    #[error("Bluetooth adapter not found")]
    AdapterNotFound,

    #[error("Device not found: {0}")]
    DeviceNotFound(String),

    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Characteristic not found: {0}")]
    CharacteristicNotFound(String),

    #[error("Write failed: {0}")]
    WriteFailed(String),

    #[error("Read failed: {0}")]
    ReadFailed(String),

    #[error("Scan failed: {0}")]
    ScanFailed(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for Bluetooth operations
pub type BluetoothResult<T> = Result<T, BluetoothError>;

/// Scanned Bluetooth device information
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScannedDevice {
    pub id: String,
    pub name: Option<String>,
    pub rssi: Option<i16>,
    pub is_connected: bool,
}

// PrinterCommand moved to crate::escpos. Re-exported below so existing
// `use bluetooth::PrinterCommand;` import sites in main.rs keep compiling
// without churn during the Phase 1.3 refactor.
pub use crate::escpos::PrinterCommand;

/// The hardware seam over the BLE radio.
///
/// Every method deals in plain data so the implementation can be a real
/// `btleplug` radio ([`BtleplugAdapter`]) *or* an in-memory fake. The
/// trait is intentionally narrow — only the operations `BluetoothManager`
/// actually needs — which keeps both the real adapter and the fake small.
///
/// `connect`/`disconnect` operate on a device id and are idempotent-friendly:
/// implementations should treat connecting an already-connected device as a
/// no-op success rather than an error, mirroring btleplug semantics.
#[async_trait]
pub trait BleAdapter: Send + Sync {
    /// Scan for `duration_secs` seconds and return discovered devices.
    async fn scan(&self, duration_secs: u64) -> BluetoothResult<Vec<ScannedDevice>>;

    /// Connect to (and discover services on) the device with this id.
    async fn connect(&self, device_id: &str) -> BluetoothResult<()>;

    /// Disconnect the device with this id.
    async fn disconnect(&self, device_id: &str) -> BluetoothResult<()>;

    /// Write `data` to `characteristic_uuid` on the connected `device_id`.
    async fn write(
        &self,
        device_id: &str,
        characteristic_uuid: &str,
        data: &[u8],
    ) -> BluetoothResult<()>;

    /// Read the current value of `characteristic_uuid` on `device_id`.
    async fn read(&self, device_id: &str, characteristic_uuid: &str) -> BluetoothResult<Vec<u8>>;
}

/// Bluetooth manager for device scanning and connection.
///
/// Generic over the [`BleAdapter`] seam so the same logic runs against the
/// real radio in production and an in-memory fake in tests. The
/// `connected_devices` set is the manager's own bookkeeping (which device ids
/// the manager believes are connected); the underlying adapter owns the real
/// radio state.
pub struct BluetoothManager<A: BleAdapter = BtleplugAdapter> {
    adapter: A,
    /// Device ids the manager has connected. Separate from the adapter's own
    /// radio state so `disconnect`/`write` can fail fast with `DeviceNotFound`
    /// before touching the radio for a device we never connected.
    connected_devices: Arc<Mutex<HashMap<String, ()>>>,
}

impl BluetoothManager<BtleplugAdapter> {
    /// Create a new Bluetooth manager backed by the real `btleplug` radio.
    /// Production entry point — behavior-preserving wrapper over the real
    /// adapter.
    pub async fn new() -> BluetoothResult<Self> {
        let adapter = BtleplugAdapter::new().await?;
        Ok(Self::with_adapter(adapter))
    }
}

impl<A: BleAdapter> BluetoothManager<A> {
    /// Construct a manager over any [`BleAdapter`]. The seam: tests pass a
    /// fake; production passes [`BtleplugAdapter`] via [`BluetoothManager::new`].
    pub fn with_adapter(adapter: A) -> Self {
        Self {
            adapter,
            connected_devices: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Scan for Bluetooth devices.
    ///
    /// # Arguments
    /// * `duration_secs` - How long to scan for devices (in seconds)
    pub async fn scan_devices(&self, duration_secs: u64) -> BluetoothResult<Vec<ScannedDevice>> {
        self.adapter.scan(duration_secs).await
    }

    /// Connect to a Bluetooth device and record it as connected.
    pub async fn connect_device(&self, device_id: &str) -> BluetoothResult<()> {
        self.adapter.connect(device_id).await?;
        {
            let mut devices = self.connected_devices.lock().unwrap();
            devices.insert(device_id.to_string(), ());
        }
        Ok(())
    }

    /// Disconnect from a Bluetooth device.
    ///
    /// Fails with [`BluetoothError::DeviceNotFound`] if the manager never
    /// connected this device — we don't ask the radio to drop a link we don't
    /// own.
    pub async fn disconnect_device(&self, device_id: &str) -> BluetoothResult<()> {
        {
            let mut devices = self.connected_devices.lock().unwrap();
            if devices.remove(device_id).is_none() {
                return Err(BluetoothError::DeviceNotFound(device_id.to_string()));
            }
        }
        self.adapter.disconnect(device_id).await
    }

    /// Write data to a characteristic on a connected device.
    pub async fn write_characteristic(
        &self,
        device_id: &str,
        characteristic_uuid: &str,
        data: &[u8],
    ) -> BluetoothResult<()> {
        self.ensure_connected(device_id)?;
        self.adapter
            .write(device_id, characteristic_uuid, data)
            .await
    }

    /// Read data from a characteristic on a connected device.
    pub async fn read_characteristic(
        &self,
        device_id: &str,
        characteristic_uuid: &str,
    ) -> BluetoothResult<Vec<u8>> {
        self.ensure_connected(device_id)?;
        self.adapter.read(device_id, characteristic_uuid).await
    }

    /// Print to a Bluetooth printer by streaming each command's bytes to the
    /// printer's write characteristic, with a small inter-command delay.
    ///
    /// # Arguments
    /// * `device_id` - The printer device ID
    /// * `commands` - List of printer commands to send
    pub async fn print(
        &self,
        device_id: &str,
        commands: Vec<PrinterCommand>,
    ) -> BluetoothResult<()> {
        // Common printer write characteristic UUID (may need adjustment per printer)
        const PRINTER_WRITE_UUID: &str = "0000ff01-0000-1000-8000-00805f9b34fb";

        for command in commands {
            let data = command.to_bytes();
            self.write_characteristic(device_id, PRINTER_WRITE_UUID, &data)
                .await?;

            // Small delay between commands so the printer's buffer keeps up.
            sleep(Duration::from_millis(50)).await;
        }

        Ok(())
    }

    /// Get list of connected devices (the manager's bookkeeping view).
    pub fn get_connected_devices(&self) -> Vec<String> {
        let devices = self.connected_devices.lock().unwrap();
        devices.keys().cloned().collect()
    }

    /// Guard: the device must be in the manager's connected set before any
    /// read/write. Keeps a single source of truth for the not-found error.
    fn ensure_connected(&self, device_id: &str) -> BluetoothResult<()> {
        let devices = self.connected_devices.lock().unwrap();
        if devices.contains_key(device_id) {
            Ok(())
        } else {
            Err(BluetoothError::DeviceNotFound(device_id.to_string()))
        }
    }
}

// ---------------------------------------------------------------------------
// Real radio adapter (thin btleplug wrapper behind the seam).
// ---------------------------------------------------------------------------

mod btleplug_impl {
    //! The real radio lives here so the `btleplug` imports stay isolated to a
    //! single module. Everything above this point is hardware-free and unit
    //! testable; everything here is the thin adapter that talks to the OS BLE
    //! stack and is exercised only on real hardware / in manual QA.

    use super::{BleAdapter, BluetoothError, BluetoothResult, ScannedDevice};
    use async_trait::async_trait;
    use btleplug::api::{Central, Manager as _, Peripheral as _, ScanFilter, WriteType};
    use btleplug::platform::{Adapter, Manager, Peripheral};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;
    use tokio::time::sleep;
    use uuid::Uuid;

    /// Real `btleplug`-backed [`BleAdapter`].
    pub struct BtleplugAdapter {
        manager: Manager,
        adapter: Arc<Mutex<Option<Adapter>>>,
        connected: Arc<Mutex<std::collections::HashMap<String, Peripheral>>>,
    }

    impl BtleplugAdapter {
        pub async fn new() -> BluetoothResult<Self> {
            let manager = Manager::new()
                .await
                .map_err(|e| BluetoothError::Internal(e.to_string()))?;
            Ok(Self {
                manager,
                adapter: Arc::new(Mutex::new(None)),
                connected: Arc::new(Mutex::new(std::collections::HashMap::new())),
            })
        }

        /// Get (and cache) the first available OS adapter.
        async fn get_adapter(&self) -> BluetoothResult<Adapter> {
            {
                let adapter_lock = self.adapter.lock().unwrap();
                if let Some(adapter) = adapter_lock.as_ref() {
                    return Ok(adapter.clone());
                }
            }
            let adapters = self
                .manager
                .adapters()
                .await
                .map_err(|e| BluetoothError::Internal(e.to_string()))?;
            let adapter = adapters
                .into_iter()
                .next()
                .ok_or(BluetoothError::AdapterNotFound)?;
            {
                let mut adapter_lock = self.adapter.lock().unwrap();
                *adapter_lock = Some(adapter.clone());
            }
            Ok(adapter)
        }

        async fn find_peripheral(&self, device_id: &str) -> BluetoothResult<Peripheral> {
            let adapter = self.get_adapter().await?;
            let peripherals = adapter
                .peripherals()
                .await
                .map_err(|e| BluetoothError::Internal(e.to_string()))?;
            peripherals
                .into_iter()
                .find(|p| p.id().to_string() == device_id)
                .ok_or_else(|| BluetoothError::DeviceNotFound(device_id.to_string()))
        }

        fn parse_uuid(s: &str) -> BluetoothResult<Uuid> {
            Uuid::parse_str(s).map_err(|e| BluetoothError::CharacteristicNotFound(e.to_string()))
        }
    }

    #[async_trait]
    impl BleAdapter for BtleplugAdapter {
        async fn scan(&self, duration_secs: u64) -> BluetoothResult<Vec<ScannedDevice>> {
            let adapter = self.get_adapter().await?;
            adapter
                .start_scan(ScanFilter::default())
                .await
                .map_err(|e| BluetoothError::ScanFailed(e.to_string()))?;
            sleep(Duration::from_secs(duration_secs)).await;
            adapter
                .stop_scan()
                .await
                .map_err(|e| BluetoothError::ScanFailed(e.to_string()))?;

            let peripherals = adapter
                .peripherals()
                .await
                .map_err(|e| BluetoothError::ScanFailed(e.to_string()))?;

            let mut devices = Vec::new();
            for peripheral in peripherals {
                let properties = peripheral
                    .properties()
                    .await
                    .map_err(|e| BluetoothError::Internal(e.to_string()))?;
                let is_connected = peripheral
                    .is_connected()
                    .await
                    .map_err(|e| BluetoothError::Internal(e.to_string()))?;
                if let Some(props) = properties {
                    devices.push(ScannedDevice {
                        id: peripheral.id().to_string(),
                        name: props.local_name,
                        rssi: props.rssi,
                        is_connected,
                    });
                }
            }
            Ok(devices)
        }

        async fn connect(&self, device_id: &str) -> BluetoothResult<()> {
            let peripheral = self.find_peripheral(device_id).await?;
            let is_connected = peripheral
                .is_connected()
                .await
                .map_err(|e| BluetoothError::Internal(e.to_string()))?;
            if !is_connected {
                peripheral
                    .connect()
                    .await
                    .map_err(|e| BluetoothError::ConnectionFailed(e.to_string()))?;
                peripheral
                    .discover_services()
                    .await
                    .map_err(|e| BluetoothError::ConnectionFailed(e.to_string()))?;
            }
            {
                let mut devices = self.connected.lock().unwrap();
                devices.insert(device_id.to_string(), peripheral);
            }
            Ok(())
        }

        async fn disconnect(&self, device_id: &str) -> BluetoothResult<()> {
            let peripheral = {
                let mut devices = self.connected.lock().unwrap();
                devices
                    .remove(device_id)
                    .ok_or_else(|| BluetoothError::DeviceNotFound(device_id.to_string()))?
            };
            peripheral
                .disconnect()
                .await
                .map_err(|e| BluetoothError::ConnectionFailed(e.to_string()))?;
            Ok(())
        }

        async fn write(
            &self,
            device_id: &str,
            characteristic_uuid: &str,
            data: &[u8],
        ) -> BluetoothResult<()> {
            let peripheral = {
                let devices = self.connected.lock().unwrap();
                devices
                    .get(device_id)
                    .cloned()
                    .ok_or_else(|| BluetoothError::DeviceNotFound(device_id.to_string()))?
            };
            let uuid = Self::parse_uuid(characteristic_uuid)?;
            let characteristics = peripheral.characteristics();
            let characteristic =
                characteristics
                    .iter()
                    .find(|c| c.uuid == uuid)
                    .ok_or_else(|| {
                        BluetoothError::CharacteristicNotFound(characteristic_uuid.to_string())
                    })?;
            peripheral
                .write(characteristic, data, WriteType::WithoutResponse)
                .await
                .map_err(|e| BluetoothError::WriteFailed(e.to_string()))?;
            Ok(())
        }

        async fn read(
            &self,
            device_id: &str,
            characteristic_uuid: &str,
        ) -> BluetoothResult<Vec<u8>> {
            let peripheral = {
                let devices = self.connected.lock().unwrap();
                devices
                    .get(device_id)
                    .cloned()
                    .ok_or_else(|| BluetoothError::DeviceNotFound(device_id.to_string()))?
            };
            let uuid = Self::parse_uuid(characteristic_uuid)?;
            let characteristics = peripheral.characteristics();
            let characteristic =
                characteristics
                    .iter()
                    .find(|c| c.uuid == uuid)
                    .ok_or_else(|| {
                        BluetoothError::CharacteristicNotFound(characteristic_uuid.to_string())
                    })?;
            let data = peripheral
                .read(characteristic)
                .await
                .map_err(|e| BluetoothError::ReadFailed(e.to_string()))?;
            Ok(data)
        }
    }
}

pub use btleplug_impl::BtleplugAdapter;

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// An in-memory [`BleAdapter`] standing in for a real radio. It records
    /// every write so we can assert the exact byte stream the manager sends,
    /// and lets a test seed scan results / failures without any hardware.
    #[derive(Default)]
    struct FakeAdapter {
        /// Devices returned by `scan`.
        scannable: Vec<ScannedDevice>,
        /// Every (device_id, characteristic_uuid, bytes) tuple written.
        writes: Mutex<Vec<(String, String, Vec<u8>)>>,
        /// Canned read response.
        read_response: Vec<u8>,
        /// Device ids that should fail to connect (e.g. out of range).
        unconnectable: Vec<String>,
        /// Count of scan() invocations — proves the manager delegates.
        scan_calls: AtomicU64,
    }

    impl FakeAdapter {
        fn writes(&self) -> Vec<(String, String, Vec<u8>)> {
            self.writes.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl BleAdapter for FakeAdapter {
        async fn scan(&self, _duration_secs: u64) -> BluetoothResult<Vec<ScannedDevice>> {
            self.scan_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.scannable.clone())
        }

        async fn connect(&self, device_id: &str) -> BluetoothResult<()> {
            if self.unconnectable.iter().any(|d| d == device_id) {
                return Err(BluetoothError::ConnectionFailed(format!(
                    "{} out of range",
                    device_id
                )));
            }
            Ok(())
        }

        async fn disconnect(&self, _device_id: &str) -> BluetoothResult<()> {
            Ok(())
        }

        async fn write(
            &self,
            device_id: &str,
            characteristic_uuid: &str,
            data: &[u8],
        ) -> BluetoothResult<()> {
            self.writes.lock().unwrap().push((
                device_id.to_string(),
                characteristic_uuid.to_string(),
                data.to_vec(),
            ));
            Ok(())
        }

        async fn read(
            &self,
            _device_id: &str,
            _characteristic_uuid: &str,
        ) -> BluetoothResult<Vec<u8>> {
            Ok(self.read_response.clone())
        }
    }

    fn dev(id: &str, name: &str) -> ScannedDevice {
        ScannedDevice {
            id: id.to_string(),
            name: Some(name.to_string()),
            rssi: Some(-50),
            is_connected: false,
        }
    }

    #[test]
    fn printer_command_bytes() {
        // Initialize emits ESC @ (reset) followed by ESC t 13 (select CP-857 /
        // Turkish) — see crate::escpos.
        assert_eq!(
            PrinterCommand::Initialize.to_bytes(),
            vec![0x1B, 0x40, 0x1B, 0x74, 13]
        );
        assert_eq!(
            PrinterCommand::Text("Hello".to_string()).to_bytes(),
            "Hello".as_bytes().to_vec()
        );
        assert_eq!(PrinterCommand::Cut.to_bytes(), vec![0x1D, 0x56, 0x00]);
    }

    #[tokio::test]
    async fn scan_delegates_to_adapter_and_returns_devices() {
        let adapter = FakeAdapter {
            scannable: vec![dev("aa:bb", "Counter Printer"), dev("cc:dd", "Drawer")],
            ..Default::default()
        };
        let mgr = BluetoothManager::with_adapter(adapter);

        let found = mgr.scan_devices(1).await.unwrap();

        assert_eq!(found.len(), 2);
        assert_eq!(found[0].id, "aa:bb");
        assert_eq!(found[0].name.as_deref(), Some("Counter Printer"));
    }

    #[tokio::test]
    async fn connect_records_device_then_disconnect_removes_it() {
        let mgr = BluetoothManager::with_adapter(FakeAdapter::default());

        assert!(mgr.get_connected_devices().is_empty());
        mgr.connect_device("aa:bb").await.unwrap();
        assert_eq!(mgr.get_connected_devices(), vec!["aa:bb".to_string()]);

        mgr.disconnect_device("aa:bb").await.unwrap();
        assert!(mgr.get_connected_devices().is_empty());
    }

    #[tokio::test]
    async fn connect_failure_does_not_record_device() {
        let adapter = FakeAdapter {
            unconnectable: vec!["aa:bb".to_string()],
            ..Default::default()
        };
        let mgr = BluetoothManager::with_adapter(adapter);

        let err = mgr.connect_device("aa:bb").await.unwrap_err();
        assert!(matches!(err, BluetoothError::ConnectionFailed(_)));
        // A failed connect must not leave a phantom entry in the connected set,
        // otherwise the UI would show a green dot for an unreachable device.
        assert!(mgr.get_connected_devices().is_empty());
    }

    #[tokio::test]
    async fn disconnect_unknown_device_errors() {
        let mgr = BluetoothManager::with_adapter(FakeAdapter::default());
        let err = mgr.disconnect_device("never-connected").await.unwrap_err();
        assert!(matches!(err, BluetoothError::DeviceNotFound(ref id) if id == "never-connected"));
    }

    #[tokio::test]
    async fn write_to_unconnected_device_is_device_not_found() {
        let mgr = BluetoothManager::with_adapter(FakeAdapter::default());
        let err = mgr
            .write_characteristic("ghost", "0000ff01-0000-1000-8000-00805f9b34fb", &[1, 2, 3])
            .await
            .unwrap_err();
        assert!(matches!(err, BluetoothError::DeviceNotFound(_)));
    }

    #[tokio::test]
    async fn read_from_unconnected_device_is_device_not_found() {
        let mgr = BluetoothManager::with_adapter(FakeAdapter::default());
        let err = mgr
            .read_characteristic("ghost", "0000ff01-0000-1000-8000-00805f9b34fb")
            .await
            .unwrap_err();
        assert!(matches!(err, BluetoothError::DeviceNotFound(_)));
    }

    #[tokio::test]
    async fn read_returns_adapter_payload_for_connected_device() {
        let adapter = FakeAdapter {
            read_response: vec![0xDE, 0xAD],
            ..Default::default()
        };
        let mgr = BluetoothManager::with_adapter(adapter);
        mgr.connect_device("aa:bb").await.unwrap();

        let data = mgr
            .read_characteristic("aa:bb", "0000ff01-0000-1000-8000-00805f9b34fb")
            .await
            .unwrap();
        assert_eq!(data, vec![0xDE, 0xAD]);
    }

    #[tokio::test]
    async fn print_streams_each_command_to_the_write_characteristic() {
        // This is the load-bearing logic test: print() must serialise each
        // PrinterCommand to bytes and write them, in order, to the printer's
        // write characteristic. We assert the exact byte streams the fake saw.
        let mgr = BluetoothManager::with_adapter(FakeAdapter::default());
        mgr.connect_device("printer-1").await.unwrap();

        mgr.print(
            "printer-1",
            vec![PrinterCommand::Initialize, PrinterCommand::Cut],
        )
        .await
        .unwrap();

        let writes = mgr_writes(&mgr);
        assert_eq!(writes.len(), 2, "one write per command");
        // All writes target the printer write characteristic on the same device.
        const PRINTER_WRITE_UUID: &str = "0000ff01-0000-1000-8000-00805f9b34fb";
        assert_eq!(writes[0].0, "printer-1");
        assert_eq!(writes[0].1, PRINTER_WRITE_UUID);
        assert_eq!(writes[0].2, vec![0x1B, 0x40, 0x1B, 0x74, 13]); // Initialize
        assert_eq!(writes[1].2, vec![0x1D, 0x56, 0x00]); // Cut
    }

    #[tokio::test]
    async fn print_to_unconnected_printer_fails_before_writing() {
        let adapter = FakeAdapter::default();
        let mgr = BluetoothManager::with_adapter(adapter);

        let err = mgr
            .print("printer-1", vec![PrinterCommand::Initialize])
            .await
            .unwrap_err();
        assert!(matches!(err, BluetoothError::DeviceNotFound(_)));
        // Nothing should have been written to the radio.
        assert!(mgr_writes(&mgr).is_empty());
    }

    /// Helper: read the fake adapter's recorded writes back out of a manager.
    /// `BluetoothManager` owns its adapter by value; because `tests` is a child
    /// module of `bluetooth`, it can reach the private `adapter` field to
    /// inspect what the manager actually wrote to the radio.
    fn mgr_writes(mgr: &BluetoothManager<FakeAdapter>) -> Vec<(String, String, Vec<u8>)> {
        mgr.adapter.writes()
    }
}

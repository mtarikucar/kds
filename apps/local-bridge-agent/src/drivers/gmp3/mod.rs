//! Vendor-neutral GMP-3 driver for Turkish *Yeni Nesil ÖKC* devices.
//!
//! One driver (`kind = "gmp3"`) serves the whole family of GİB GMP-3 ÖKCs; the
//! per-vendor bits live in [`profiles`]. It handles BOTH command families a
//! single physical device exposes:
//!   - coupled card sale (`charge_card` / `void_card`) — the payment-terminal
//!     rail, `paygo_ecr` provider;
//!   - standalone fiş (`fiscal_receipt` / `fiscal_cancel` / `fiscal_report`) —
//!     the fiscal-core rail, `fiscal_paygo` provider;
//!   - plus `capability_probe`.
//!
//! ## Routing
//! The cloud GMP-3 adapters emit `protocol: "GMP3"` + `vendorProfile` (no
//! `target`), so the driver registry routes GMP-3-protocol commands here (see
//! `drivers::Registry::dispatch`).
//!
//! ## Transport config (resolved LOCALLY, like `printers.toml`)
//! The cloud never learns the device's LAN address (NAT); it lives on-prem in
//! `gmp3.toml` in the bridge data dir, keyed by the device serial (== the
//! command's `fiscalSerial`):
//!
//! ```toml
//! [[device]]
//! serial = "5B0024050735"   # matches the command's fiscalSerial
//! mode = "simulator"        # "simulator" (test) | "real" (Phase 1, cert'd)
//! sim_outcome = "approve"   # simulator only: approve | decline | error
//! host = "192.168.1.60"     # required for real mode
//! port = 59000              # optional; profile default otherwise
//! ```
//!
//! ## Honest failure (no fake success)
//! `mode = "real"` fails closed until the vendor's certified handshake ships
//! (`VendorProfile::real_impl_ready`) — we never fabricate an approval or a fiş.
//! A device not present in `gmp3.toml`, an unknown vendor profile, or an
//! unhandled kind all surface as `Err` (→ a `failed` ack), never a silent no-op.

pub mod profiles;
pub mod protocol;
pub mod transport;

use crate::{
    command_queue::{CommandOutcome, PendingCommand},
    drivers::LocalDriver,
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use serde::Deserialize;
use std::path::{Path, PathBuf};

use profiles::VendorProfile;
use protocol::{CommandFamily, SimOutcome, SimResult};

/// One device's on-prem transport config from `gmp3.toml`.
#[derive(Debug, Clone, Deserialize)]
struct Gmp3DeviceEntry {
    /// Device serial — matched against the command's `fiscalSerial`.
    serial: String,
    /// "simulator" (opt-in test mode) | anything else → real (fail-closed in
    /// Phase 0). Defaulting the UNSET/unknown value to real is deliberate: a
    /// misconfigured device must fail closed, never silently simulate a sale.
    #[serde(default)]
    mode: Option<String>,
    /// Simulator only: approve (default) | decline | error.
    #[serde(default)]
    sim_outcome: Option<String>,
    /// LAN host (required for real mode; unused by the simulator).
    #[serde(default)]
    #[allow(dead_code)] // consumed by the real path (Phase 1); kept honest here.
    host: Option<String>,
    /// LAN port (optional; the vendor profile's default applies otherwise).
    #[serde(default)]
    #[allow(dead_code)]
    port: Option<u16>,
}

impl Gmp3DeviceEntry {
    fn is_simulator(&self) -> bool {
        matches!(
            self.mode.as_deref().map(|m| m.trim().to_ascii_lowercase()),
            Some(ref m) if m == "simulator" || m == "sim"
        )
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
struct Gmp3Config {
    #[serde(default)]
    device: Vec<Gmp3DeviceEntry>,
}

/// The GMP-3 driver. Holds the locally-configured device transports (loaded once
/// at boot from `gmp3.toml`). Like the ESC/POS driver, it registers even when
/// the config is absent (so the agent boots) and fails honestly at command time.
pub struct Gmp3Driver {
    devices: Vec<Gmp3DeviceEntry>,
    /// Where `gmp3.toml` was looked for — named in errors so an operator knows
    /// exactly which file to create/fix.
    config_path: PathBuf,
}

impl Gmp3Driver {
    /// Production init: read `gmp3.toml` from the bridge data dir. Always
    /// registers the driver (returns `Some`) so a missing config doesn't drop
    /// the `gmp3` kind — the failure surfaces honestly at command time.
    pub async fn try_init(data_dir: &Path) -> Result<Option<Self>> {
        let config_path = data_dir.join("gmp3.toml");
        let devices = match load_config(&config_path) {
            Ok(d) => {
                tracing::info!(
                    count = d.len(),
                    path = %config_path.display(),
                    "gmp3: loaded device transports"
                );
                d
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    path = %config_path.display(),
                    "gmp3: no usable device config; GMP-3 commands will FAIL until gmp3.toml is set"
                );
                Vec::new()
            }
        };
        Ok(Some(Gmp3Driver {
            devices,
            config_path,
        }))
    }

    #[cfg(test)]
    fn with_devices(devices: Vec<Gmp3DeviceEntry>) -> Self {
        Gmp3Driver {
            devices,
            config_path: PathBuf::from("<test>/gmp3.toml"),
        }
    }

    fn find(&self, serial: &str) -> Option<&Gmp3DeviceEntry> {
        self.devices.iter().find(|d| d.serial == serial)
    }

    fn payload_str<'a>(&self, cmd: &'a PendingCommand, key: &str) -> Option<&'a str> {
        cmd.payload.get(key).and_then(|v| v.as_str())
    }
}

#[async_trait]
impl LocalDriver for Gmp3Driver {
    fn kind(&self) -> &str {
        "gmp3"
    }

    async fn execute(&self, cmd: &PendingCommand) -> Result<CommandOutcome> {
        // 1. Defensive protocol check (dispatch already routed us GMP-3 traffic).
        let protocol = self.payload_str(cmd, "protocol").unwrap_or("");
        if protocol != "GMP3" {
            return Err(anyhow!(
                "gmp3: command {} has protocol '{}', expected 'GMP3'",
                cmd.id,
                protocol
            ));
        }

        // 2. Resolve the vendor profile from the command.
        let vendor_profile = self.payload_str(cmd, "vendorProfile").unwrap_or("");
        let profile: &VendorProfile = profiles::resolve(vendor_profile).ok_or_else(|| {
            anyhow!(
                "gmp3: unknown vendorProfile '{}' for command {} (known: {})",
                vendor_profile,
                cmd.id,
                profiles::known_ids().join(", ")
            )
        })?;

        // 3. Classify the command kind into a GMP-3 family.
        let family: CommandFamily = protocol::classify(&cmd.kind).ok_or_else(|| {
            anyhow!(
                "gmp3: driver does not handle command kind '{}' (command {})",
                cmd.kind,
                cmd.id
            )
        })?;

        // 4. Resolve the on-prem device config by serial. No entry ⇒ fail closed
        //    (never fabricate a device), naming the config file to fix.
        let fiscal_serial = self.payload_str(cmd, "fiscalSerial").unwrap_or("");
        let device = self.find(fiscal_serial).ok_or_else(|| {
            if self.devices.is_empty() {
                anyhow!(
                    "gmp3: no devices configured (looked in {}). Cannot run {} for serial '{}' — create gmp3.toml",
                    self.config_path.display(),
                    cmd.kind,
                    fiscal_serial
                )
            } else {
                anyhow!(
                    "gmp3: no device with serial '{}' in {} (have: {})",
                    fiscal_serial,
                    self.config_path.display(),
                    self.devices
                        .iter()
                        .map(|d| d.serial.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            }
        })?;

        // 5. Simulator vs. real.
        if device.is_simulator() {
            let outcome = SimOutcome::parse(device.sim_outcome.as_deref().unwrap_or("approve"));
            tracing::info!(
                serial = %fiscal_serial,
                vendor = %profile.id,
                kind = %cmd.kind,
                outcome = ?outcome,
                "gmp3: SIMULATOR — no hardware touched"
            );
            return match protocol::simulate(family, &cmd.id, outcome) {
                SimResult::Done(result) => Ok(CommandOutcome {
                    status: "done".to_string(),
                    result,
                    error: None,
                }),
                // A simulated error/decline-as-error drives the SAME honest
                // failure path a real device error/timeout would (kind-aware
                // parking + failed ack), so the recovery rail is exercised too.
                SimResult::Failed(err) => Err(anyhow!(err)),
            };
        }

        // Real mode: fail closed until the vendor's certified handshake ships.
        // We do NOT open a socket we cannot complete a transaction over —
        // partial contact with a fiscal/card device is worse than none.
        if !profile.real_impl_ready {
            return Err(anyhow!(protocol::real_mode_unavailable(
                profile.display_name,
                profile.id
            )));
        }

        // Phase 1: the certified handshake/TLV/crypto over transport::TcpEndpoint
        // lands here (build request → request_reply → parse → outcome). Until a
        // profile flips real_impl_ready true, this is unreachable.
        Err(anyhow!(
            "gmp3: real transport for {} is marked ready but not wired — build error",
            profile.id
        ))
    }
}

/// Load + validate `gmp3.toml`. Errors if the file is missing or unparseable, or
/// declares zero devices, so the caller logs it and registers the driver in a
/// "will fail honestly" state (parity with the ESC/POS printer config).
fn load_config(path: &Path) -> Result<Vec<Gmp3DeviceEntry>> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("reading gmp3 config {}", path.display()))?;
    let cfg: Gmp3Config =
        toml::from_str(&raw).with_context(|| format!("parsing gmp3 config {}", path.display()))?;
    if cfg.device.is_empty() {
        return Err(anyhow!(
            "gmp3 config {} has no [[device]] entries",
            path.display()
        ));
    }
    Ok(cfg.device)
}

/// The un-decorated result shape helper for tests / callers that want to assert
/// the JSON without matching on `CommandOutcome`.
#[cfg(test)]
fn cmd(id: &str, kind: &str, payload: serde_json::Value) -> PendingCommand {
    PendingCommand {
        id: id.to_string(),
        kind: kind.to_string(),
        payload,
        priority: 10,
        attempts: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sim_device(serial: &str, outcome: &str) -> Gmp3DeviceEntry {
        Gmp3DeviceEntry {
            serial: serial.to_string(),
            mode: Some("simulator".to_string()),
            sim_outcome: Some(outcome.to_string()),
            host: None,
            port: None,
        }
    }

    fn charge_payload(serial: &str) -> serde_json::Value {
        json!({
            "protocol": "GMP3",
            "vendorProfile": "paygo.sp630",
            "fiscalSerial": serial,
            "amountCents": 12345,
            "currency": "TRY",
            "orderId": "o1",
        })
    }

    #[tokio::test]
    async fn kind_is_gmp3() {
        let d = Gmp3Driver::with_devices(vec![]);
        assert_eq!(d.kind(), "gmp3");
    }

    #[tokio::test]
    async fn simulator_charge_approves_with_coupled_fiscal_no() {
        let d = Gmp3Driver::with_devices(vec![sim_device("SER-1", "approve")]);
        let out = d
            .execute(&cmd("c-1", "charge_card", charge_payload("SER-1")))
            .await
            .expect("simulator charge succeeds");
        assert_eq!(out.status, "done");
        assert_eq!(out.result["approved"], true);
        assert!(out.result["fiscalNo"]
            .as_str()
            .unwrap()
            .starts_with("SIMFIS-"));
    }

    #[tokio::test]
    async fn simulator_decline_is_done_not_approved() {
        let d = Gmp3Driver::with_devices(vec![sim_device("SER-1", "decline")]);
        let out = d
            .execute(&cmd("c-2", "charge_card", charge_payload("SER-1")))
            .await
            .expect("decline is a done ack");
        assert_eq!(out.status, "done");
        assert_eq!(out.result["approved"], false);
    }

    #[tokio::test]
    async fn simulator_error_is_a_failed_dispatch() {
        let d = Gmp3Driver::with_devices(vec![sim_device("SER-1", "error")]);
        assert!(
            d.execute(&cmd("c-3", "charge_card", charge_payload("SER-1")))
                .await
                .is_err(),
            "a simulated error must drive the honest failure path"
        );
    }

    #[tokio::test]
    async fn simulator_fiscal_receipt_returns_fiscal_no() {
        let d = Gmp3Driver::with_devices(vec![sim_device("SER-1", "approve")]);
        let payload = json!({
            "protocol": "GMP3", "vendorProfile": "paygo.sp630",
            "fiscalSerial": "SER-1", "kind": "cash_receipt",
        });
        let out = d
            .execute(&cmd("c-4", "fiscal_receipt", payload))
            .await
            .expect("simulator fiş succeeds");
        assert_eq!(out.status, "done");
        assert!(out.result["fiscalNo"]
            .as_str()
            .unwrap()
            .starts_with("SIMFIS-"));
    }

    #[tokio::test]
    async fn real_mode_fails_closed_for_uncertified_vendor() {
        let d = Gmp3Driver::with_devices(vec![Gmp3DeviceEntry {
            serial: "SER-1".to_string(),
            mode: Some("real".to_string()),
            sim_outcome: None,
            host: Some("192.168.1.60".to_string()),
            port: Some(59000),
        }]);
        let err = d
            .execute(&cmd("c-5", "charge_card", charge_payload("SER-1")))
            .await
            .expect_err("real mode must fail closed in Phase 0");
        assert!(err.to_string().contains("not certified"), "got: {err}");
    }

    #[tokio::test]
    async fn unconfigured_serial_fails_honestly() {
        let d = Gmp3Driver::with_devices(vec![sim_device("SER-1", "approve")]);
        let err = d
            .execute(&cmd("c-6", "charge_card", charge_payload("UNKNOWN")))
            .await
            .expect_err("a serial not in gmp3.toml must fail, not fake success");
        assert!(err.to_string().contains("UNKNOWN"), "got: {err}");
    }

    #[tokio::test]
    async fn unknown_vendor_profile_fails() {
        let d = Gmp3Driver::with_devices(vec![sim_device("SER-1", "approve")]);
        let payload = json!({
            "protocol": "GMP3", "vendorProfile": "acme.9000", "fiscalSerial": "SER-1",
        });
        let err = d
            .execute(&cmd("c-7", "charge_card", payload))
            .await
            .expect_err("unknown vendor profile must fail");
        assert!(err.to_string().contains("acme.9000"), "got: {err}");
    }

    #[tokio::test]
    async fn no_devices_configured_fails_with_config_hint() {
        let d = Gmp3Driver::with_devices(vec![]);
        let err = d
            .execute(&cmd("c-8", "charge_card", charge_payload("SER-1")))
            .await
            .expect_err("no gmp3.toml → honest failure");
        assert!(
            err.to_string().contains("no devices configured"),
            "got: {err}"
        );
    }

    #[test]
    fn loads_devices_from_toml() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("gmp3.toml");
        std::fs::write(
            &path,
            r#"
                [[device]]
                serial = "5B0024050735"
                mode = "simulator"
                sim_outcome = "approve"
                host = "192.168.1.60"
                port = 59000
            "#,
        )
        .unwrap();
        let devices = load_config(&path).unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].serial, "5B0024050735");
        assert!(devices[0].is_simulator());
    }

    #[test]
    fn missing_config_is_an_error() {
        let dir = tempfile::TempDir::new().unwrap();
        assert!(load_config(&dir.path().join("nope.toml")).is_err());
    }

    #[test]
    fn unset_mode_is_not_simulator() {
        // An entry with no `mode` must NOT be treated as a simulator — that
        // would silently fake sales on a device meant to be real.
        let entry = Gmp3DeviceEntry {
            serial: "S".to_string(),
            mode: None,
            sim_outcome: None,
            host: None,
            port: None,
        };
        assert!(!entry.is_simulator());
    }
}

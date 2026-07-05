//! Per-device-class driver registry.
//!
//! Every supported peripheral implements `LocalDriver`. The dispatch function
//! looks the driver up by the command's `target` (kind + identifier) and
//! invokes it. Failures bubble up as `anyhow::Error` so the main loop can
//! retry / fail-out uniformly.

use crate::command_queue::{CommandOutcome, PendingCommand};
use anyhow::Result;
use async_trait::async_trait;
use std::collections::HashMap;
use std::path::Path;

pub mod escpos;
pub mod gmp3;
pub mod ingenico_iwl;
pub mod yazarkasa_hugin;

#[async_trait]
pub trait LocalDriver: Send + Sync {
    /// Stable identifier used by command routing. Examples: "escpos", "hugin", "ingenico-iwl".
    fn kind(&self) -> &str;

    /// Execute one command. The driver is responsible for parsing the
    /// command payload — keeping it untyped here means new command kinds
    /// don't require touching the driver registry.
    async fn execute(&self, cmd: &PendingCommand) -> Result<CommandOutcome>;
}

pub struct Registry {
    drivers: HashMap<String, Box<dyn LocalDriver>>,
}

impl Registry {
    /// Initialise the driver registry. `data_dir` is the bridge's data
    /// directory (`cfg.data_dir`); drivers read their LAN/transport config
    /// (e.g. the ESC/POS `printers.toml`) from there.
    pub async fn init(data_dir: &Path) -> Result<Self> {
        let mut drivers: HashMap<String, Box<dyn LocalDriver>> = HashMap::new();
        // Drivers self-discover their availability — a printer driver that
        // can't find any printer simply does not register, and the agent
        // surfaces that fact to the cloud at heartbeat time.
        if let Some(d) = escpos::EscPosDriver::try_init(data_dir).await? {
            drivers.insert(d.kind().to_string(), Box::new(d));
        }
        // Vendor-neutral GMP-3 ÖKC driver (Paygo SP630 + future Turkish ÖKC
        // brands). Registers even without gmp3.toml (fails honestly at command
        // time), mirroring the ESC/POS driver.
        if let Some(d) = gmp3::Gmp3Driver::try_init(data_dir).await? {
            drivers.insert(d.kind().to_string(), Box::new(d));
        }
        if let Some(d) = yazarkasa_hugin::HuginDriver::try_init().await? {
            drivers.insert(d.kind().to_string(), Box::new(d));
        }
        if let Some(d) = ingenico_iwl::IngenicoIwlDriver::try_init().await? {
            drivers.insert(d.kind().to_string(), Box::new(d));
        }
        Ok(Self { drivers })
    }

    pub fn installed_kinds(&self) -> Vec<String> {
        self.drivers.keys().cloned().collect()
    }

    pub async fn dispatch(&self, cmd: &PendingCommand) -> Result<CommandOutcome> {
        // Routing precedence:
        //   1. An explicit `target` in the payload root wins — ESC/POS (and any
        //      command the mesh tags) identify their driver class this way
        //      ("escpos", "hugin", "ingenico-iwl").
        //   2. Otherwise a GMP-3 command (`protocol == "GMP3"`) routes to the
        //      vendor-neutral `gmp3` driver. The payment-terminal / fiscal-core
        //      GMP-3 adapters emit `protocol`+`vendorProfile` and NO `target`;
        //      the `gmp3` driver then selects the vendor by `vendorProfile`.
        let target = cmd
            .payload
            .get("target")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let protocol = cmd.payload.get("protocol").and_then(|v| v.as_str());
        let driver_kind: &str = if !target.is_empty() {
            target
        } else if protocol == Some("GMP3") {
            "gmp3"
        } else {
            ""
        };
        match self.drivers.get(driver_kind) {
            Some(driver) => driver.execute(cmd).await,
            None => anyhow::bail!(
                "no driver installed for target='{}' protocol='{}' (kind={})",
                target,
                protocol.unwrap_or(""),
                cmd.kind
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc as StdArc;

    /// A fake driver standing in for real hardware. Records how many times it
    /// was invoked so we can assert routing without touching a printer/POS.
    struct FakeDriver {
        kind: &'static str,
        calls: StdArc<AtomicUsize>,
    }

    #[async_trait]
    impl LocalDriver for FakeDriver {
        fn kind(&self) -> &str {
            self.kind
        }
        async fn execute(&self, cmd: &PendingCommand) -> Result<CommandOutcome> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            Ok(CommandOutcome {
                status: "done".to_string(),
                result: json!({ "handled_by": self.kind, "cmd_id": cmd.id }),
                error: None,
            })
        }
    }

    fn registry_with(drivers: Vec<Box<dyn LocalDriver>>) -> Registry {
        let mut map: HashMap<String, Box<dyn LocalDriver>> = HashMap::new();
        for d in drivers {
            map.insert(d.kind().to_string(), d);
        }
        Registry { drivers: map }
    }

    fn cmd_with_target(id: &str, target: Option<&str>) -> PendingCommand {
        let payload = match target {
            Some(t) => json!({ "target": t }),
            None => json!({}),
        };
        PendingCommand {
            id: id.to_string(),
            kind: "print_receipt".to_string(),
            payload,
            priority: 0,
            attempts: 0,
        }
    }

    #[tokio::test]
    async fn dispatch_routes_to_matching_driver() {
        let calls = StdArc::new(AtomicUsize::new(0));
        let reg = registry_with(vec![Box::new(FakeDriver {
            kind: "escpos",
            calls: calls.clone(),
        })]);

        let outcome = reg
            .dispatch(&cmd_with_target("c-1", Some("escpos")))
            .await
            .expect("matching driver dispatches ok");

        assert_eq!(outcome.status, "done");
        assert_eq!(outcome.result["handled_by"], "escpos");
        assert_eq!(outcome.result["cmd_id"], "c-1");
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "driver invoked exactly once"
        );
    }

    #[tokio::test]
    async fn dispatch_picks_the_correct_driver_among_several() {
        let escpos_calls = StdArc::new(AtomicUsize::new(0));
        let hugin_calls = StdArc::new(AtomicUsize::new(0));
        let reg = registry_with(vec![
            Box::new(FakeDriver {
                kind: "escpos",
                calls: escpos_calls.clone(),
            }),
            Box::new(FakeDriver {
                kind: "hugin",
                calls: hugin_calls.clone(),
            }),
        ]);

        reg.dispatch(&cmd_with_target("c-2", Some("hugin")))
            .await
            .unwrap();

        assert_eq!(hugin_calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            escpos_calls.load(Ordering::SeqCst),
            0,
            "the non-targeted driver must not run"
        );
    }

    #[tokio::test]
    async fn dispatch_errors_for_unknown_target() {
        let reg = registry_with(vec![Box::new(FakeDriver {
            kind: "escpos",
            calls: StdArc::new(AtomicUsize::new(0)),
        })]);

        let err = reg
            .dispatch(&cmd_with_target("c-3", Some("does-not-exist")))
            .await
            .expect_err("unknown target must surface as an error, not silent success");
        assert!(err.to_string().contains("no driver installed"));
        assert!(err.to_string().contains("does-not-exist"));
    }

    #[tokio::test]
    async fn dispatch_errors_when_target_missing() {
        // Missing `target` defaults to "" which matches no driver.
        let reg = registry_with(vec![Box::new(FakeDriver {
            kind: "escpos",
            calls: StdArc::new(AtomicUsize::new(0)),
        })]);
        let res = reg.dispatch(&cmd_with_target("c-4", None)).await;
        assert!(res.is_err(), "no target -> no driver -> error");
    }

    fn cmd_with_payload(id: &str, payload: serde_json::Value) -> PendingCommand {
        PendingCommand {
            id: id.to_string(),
            kind: "charge_card".to_string(),
            payload,
            priority: 0,
            attempts: 0,
        }
    }

    #[tokio::test]
    async fn dispatch_routes_gmp3_protocol_without_target_to_gmp3_driver() {
        // The payment-terminal / fiscal-core GMP-3 adapters emit protocol+
        // vendorProfile and NO target; those must reach the `gmp3` driver.
        let calls = StdArc::new(AtomicUsize::new(0));
        let reg = registry_with(vec![Box::new(FakeDriver {
            kind: "gmp3",
            calls: calls.clone(),
        })]);
        let outcome = reg
            .dispatch(&cmd_with_payload(
                "c-g1",
                json!({ "protocol": "GMP3", "vendorProfile": "paygo.sp630" }),
            ))
            .await
            .expect("GMP3 protocol routes to the gmp3 driver");
        assert_eq!(outcome.result["handled_by"], "gmp3");
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn explicit_target_wins_over_protocol() {
        let escpos_calls = StdArc::new(AtomicUsize::new(0));
        let gmp3_calls = StdArc::new(AtomicUsize::new(0));
        let reg = registry_with(vec![
            Box::new(FakeDriver {
                kind: "escpos",
                calls: escpos_calls.clone(),
            }),
            Box::new(FakeDriver {
                kind: "gmp3",
                calls: gmp3_calls.clone(),
            }),
        ]);
        // Both an explicit target AND protocol=GMP3 → target wins.
        reg.dispatch(&cmd_with_payload(
            "c-g2",
            json!({ "target": "escpos", "protocol": "GMP3" }),
        ))
        .await
        .unwrap();
        assert_eq!(escpos_calls.load(Ordering::SeqCst), 1);
        assert_eq!(gmp3_calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn installed_kinds_lists_registered_drivers() {
        let reg = registry_with(vec![
            Box::new(FakeDriver {
                kind: "escpos",
                calls: StdArc::new(AtomicUsize::new(0)),
            }),
            Box::new(FakeDriver {
                kind: "hugin",
                calls: StdArc::new(AtomicUsize::new(0)),
            }),
        ]);
        let mut kinds = reg.installed_kinds();
        kinds.sort();
        assert_eq!(kinds, vec!["escpos".to_string(), "hugin".to_string()]);
    }
}

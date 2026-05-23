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

pub mod escpos;
pub mod yazarkasa_hugin;
pub mod ingenico_iwl;

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
    pub async fn init() -> Result<Self> {
        let mut drivers: HashMap<String, Box<dyn LocalDriver>> = HashMap::new();
        // Drivers self-discover their availability — a printer driver that
        // can't find any printer simply does not register, and the agent
        // surfaces that fact to the cloud at heartbeat time.
        if let Some(d) = escpos::EscPosDriver::try_init().await? {
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
        // Convention: commands carry `target` in the payload root to identify
        // the driver class ("escpos", "hugin", "ingenico-iwl").
        let target = cmd
            .payload
            .get("target")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        match self.drivers.get(target) {
            Some(driver) => driver.execute(cmd).await,
            None => anyhow::bail!("no driver installed for target='{}' (kind={})", target, cmd.kind),
        }
    }
}

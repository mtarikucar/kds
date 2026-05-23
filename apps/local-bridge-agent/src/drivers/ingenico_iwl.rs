//! Ingenico iWL POS terminal driver. Scaffold only.
//!
//! Real implementation uses the acquirer-provided LAN protocol. Most TR
//! deployments will use BKM Express or the bank's white-labelled SDK.
//! Stubbed here so the agent compiles standalone.

use crate::{command_queue::{CommandOutcome, PendingCommand}, drivers::LocalDriver};
use anyhow::Result;
use async_trait::async_trait;
use serde_json::json;

pub struct IngenicoIwlDriver;

impl IngenicoIwlDriver {
    pub async fn try_init() -> Result<Option<Self>> {
        Ok(None)
    }
}

#[async_trait]
impl LocalDriver for IngenicoIwlDriver {
    fn kind(&self) -> &str {
        "ingenico-iwl"
    }

    async fn execute(&self, _cmd: &PendingCommand) -> Result<CommandOutcome> {
        Ok(CommandOutcome {
            status: "failed".to_string(),
            result: json!({}),
            error: Some("Ingenico iWL driver not implemented in this scaffold".to_string()),
        })
    }
}

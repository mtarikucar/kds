//! Hugin yazarkasa driver. Scaffold only.
//!
//! Real implementation talks to the Hugin serial protocol (typically RS-232
//! over a USB-Serial adapter). The protocol is documented under NDA; this
//! crate stubs the interface so the rest of the agent can be built and
//! tested without the proprietary spec.

use crate::{command_queue::{CommandOutcome, PendingCommand}, drivers::LocalDriver};
use anyhow::Result;
use async_trait::async_trait;
use serde_json::json;

pub struct HuginDriver;

impl HuginDriver {
    pub async fn try_init() -> Result<Option<Self>> {
        // Real version would probe /dev/ttyUSB* and look for the Hugin reply
        // to a status query. Scaffold: not installed in this build.
        Ok(None)
    }
}

#[async_trait]
impl LocalDriver for HuginDriver {
    fn kind(&self) -> &str {
        "hugin"
    }

    async fn execute(&self, _cmd: &PendingCommand) -> Result<CommandOutcome> {
        Ok(CommandOutcome {
            status: "failed".to_string(),
            result: json!({}),
            error: Some("Hugin driver not implemented in this scaffold".to_string()),
        })
    }
}

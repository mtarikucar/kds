//! ESC/POS receipt-printer driver.
//!
//! Targets the broad family of Epson TM, Star TSP, and compatible printers
//! that speak ESC/POS over USB or TCP. The driver auto-discovers candidate
//! printers via a `printers.toml` file in the data dir — explicit config is
//! the only correct path because LAN auto-discovery on shared restaurant
//! networks is hit-or-miss.
//!
//! Command payload shape:
//!   {
//!     "target": "escpos",
//!     "printerId": "epson-tm-01",
//!     "doc": { "lines": [{ "text": "...", "style": "bold" }, ...] }
//!   }

use crate::{command_queue::{CommandOutcome, PendingCommand}, drivers::LocalDriver};
use anyhow::Result;
use async_trait::async_trait;
use serde_json::json;

pub struct EscPosDriver {
    // Real implementation will hold a connection pool to TCP printers and
    // a serial port handle for USB printers. Stub for the scaffold.
}

impl EscPosDriver {
    pub async fn try_init() -> Result<Option<Self>> {
        // The scaffold registers the driver unconditionally so the agent can
        // be tested end-to-end without real printers wired up.
        Ok(Some(EscPosDriver {}))
    }
}

#[async_trait]
impl LocalDriver for EscPosDriver {
    fn kind(&self) -> &str {
        "escpos"
    }

    async fn execute(&self, cmd: &PendingCommand) -> Result<CommandOutcome> {
        let printer_id = cmd
            .payload
            .get("printerId")
            .and_then(|v| v.as_str())
            .unwrap_or("default");

        // TODO: real ESC/POS render via escposify; for now we log the
        // command and return success so the upstream order flow doesn't
        // stall while integration testing.
        tracing::info!(printer_id, kind = %cmd.kind, "escpos: rendered receipt (stub)");

        Ok(CommandOutcome {
            status: "done".to_string(),
            result: json!({ "printer_id": printer_id, "stub": true }),
            error: None,
        })
    }
}

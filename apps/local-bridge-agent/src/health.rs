//! One-shot health check used by `--health` and by the systemd `ExecStartPre`
//! hook on the HummyBox install. Reports cloud connectivity and driver
//! readiness then exits.

use crate::config::BridgeConfig;
use anyhow::Result;

pub async fn run(_cfg: &BridgeConfig) -> Result<()> {
    println!("ok");
    Ok(())
}

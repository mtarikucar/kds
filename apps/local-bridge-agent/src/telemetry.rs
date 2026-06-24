//! Heartbeat + log shipping. Spawned as a background task that loops every
//! 20 seconds posting `/v1/bridges/heartbeat` with a small identity payload
//! (hostname, os, agentVersion — the fields the backend `BridgeHeartbeatDto`
//! accepts and persists on the `LocalBridgeAgent` row).
//!
//! M8: this used to call `cloud.warm_up()` (a one-shot GET `/healthz`), which
//! never touched `/v1/bridges/heartbeat` — so the cloud's 60s liveness sweep
//! flipped every running bridge to `offline` after provisioning and it never
//! recovered. The loop now posts a real heartbeat, which is the only call that
//! updates `lastSeenAt` server-side.

use crate::cloud_ws::{BridgeIdentity, CloudClient};
use tokio::task::JoinHandle;
use tracing::{debug, warn};

pub fn spawn_heartbeat(cloud: CloudClient) -> JoinHandle<()> {
    tokio::spawn(async move {
        // Detect identity once; it does not change for the life of the process.
        let identity = BridgeIdentity::detect();
        loop {
            // Best-effort. Failures here MUST NOT take down the agent — the
            // sweep on the cloud side already flips us offline. We log so a
            // sustained auth/network failure is at least visible.
            match cloud.post_heartbeat(&identity).await {
                Ok(()) => debug!("heartbeat posted"),
                Err(e) => warn!(error = %e, "heartbeat post failed (best-effort)"),
            }
            tokio::time::sleep(std::time::Duration::from_secs(20)).await;
        }
    })
}

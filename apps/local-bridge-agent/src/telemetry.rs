//! Heartbeat + log shipping. Spawned as a background task that loops every
//! 20 seconds posting `/v1/bridges/heartbeat` and a small payload of metrics
//! (queue depth, last command status, driver health).

use crate::cloud_ws::CloudClient;
use tokio::task::JoinHandle;

pub fn spawn_heartbeat(cloud: CloudClient) -> JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            // Best-effort. Failures here MUST NOT take down the agent — the
            // sweep on the cloud side already flips us offline.
            let _ = cloud.warm_up().await;
            tokio::time::sleep(std::time::Duration::from_secs(20)).await;
        }
    })
}

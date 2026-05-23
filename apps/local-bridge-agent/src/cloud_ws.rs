//! Cloud transport for the bridge.
//!
//! Primary channel is WSS to `/ws/bridge`. The cloud pushes commands; the
//! bridge sends acks back on the same socket. REST fallback at
//! `/v1/bridges/:id/commands/next` is used when the WSS is down — slower,
//! but resilient against captive portals or weird LAN proxies that drop
//! upgrade headers.

use crate::{
    command_queue::{CommandOutcome, CommandQueue, PendingCommand},
    config::BridgeConfig,
};
use anyhow::Result;
use std::sync::Arc;
use tracing::warn;

#[derive(Clone)]
pub struct CloudClient {
    inner: Arc<Inner>,
}

struct Inner {
    cfg: BridgeConfig,
    http: reqwest::Client,
}

impl CloudClient {
    pub fn new(cfg: BridgeConfig) -> Self {
        let http = reqwest::Client::builder()
            .https_only(true)
            // Conservative timeouts so a wedged proxy doesn't stall the agent.
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .expect("reqwest client build");
        Self {
            inner: Arc::new(Inner { cfg, http }),
        }
    }

    /// Quick GET to confirm the cloud is reachable. Used at boot so the agent
    /// can switch to "offline mode" UI hints if the cloud is unavailable.
    pub async fn warm_up(&self) -> Result<()> {
        let url = format!("{}/healthz", self.inner.cfg.cloud_url);
        let resp = self.inner.http.get(url).send().await?;
        if !resp.status().is_success() {
            anyhow::bail!("cloud warm-up returned HTTP {}", resp.status());
        }
        Ok(())
    }

    /// Pull more commands when the local queue is empty. Uses REST polling
    /// for now; once the WSS upgrade lands the polling becomes the fallback.
    pub async fn fetch_more(&self, queue: &CommandQueue) -> Result<()> {
        let url = format!(
            "{}/v1/bridges/{}/commands/next",
            self.inner.cfg.cloud_url, self.inner.cfg.bridge_id
        );
        let token = crate::config::resolve_bearer_token().unwrap_or_default();
        let resp = self
            .inner
            .http
            .get(url)
            .header("Authorization", format!("Bridge {}", token))
            .send()
            .await?;
        if resp.status().as_u16() == 204 {
            return Ok(());
        }
        if !resp.status().is_success() {
            warn!(status = %resp.status(), "cloud fetch_more non-success");
            return Ok(());
        }
        let commands: Vec<PendingCommand> = resp.json().await.unwrap_or_default();
        for c in commands {
            queue.push(&c).await?;
        }
        Ok(())
    }

    pub async fn ack(&self, cmd: &PendingCommand, outcome: &CommandOutcome) -> Result<()> {
        let url = format!(
            "{}/v1/devices/commands/{}/ack",
            self.inner.cfg.cloud_url, cmd.id
        );
        let token = crate::config::resolve_bearer_token().unwrap_or_default();
        self.inner
            .http
            .post(url)
            .header("Authorization", format!("Bridge {}", token))
            .json(outcome)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn ack_failed(&self, cmd: &PendingCommand, error: &str) -> Result<()> {
        self.ack(
            cmd,
            &CommandOutcome {
                status: "failed".to_string(),
                result: serde_json::Value::Null,
                error: Some(error.to_string()),
            },
        )
        .await
    }
}

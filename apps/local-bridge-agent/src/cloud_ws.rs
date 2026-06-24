//! Cloud transport for the bridge.
//!
//! Primary channel is WSS to `/ws/bridge`. The cloud pushes commands; the
//! bridge sends acks back on the same socket. REST fallback at
//! `/v1/bridges/:id/commands/next` is used when the WSS is down — slower,
//! but resilient against captive portals or weird LAN proxies that drop
//! upgrade headers.
//!
//! ## The transport seam
//!
//! The *logic* of the cloud client — how a `commands/next` response is turned
//! into queue pushes, how a non-success status is tolerated, how a failed
//! command's [`CommandOutcome`] is shaped for the ack — should not require a
//! live HTTP server (or even `reqwest`) to test. So the raw HTTP calls live
//! behind the [`CloudTransport`] trait, which speaks only in plain data
//! (status codes, parsed [`PendingCommand`] lists). The real implementation is
//! [`ReqwestTransport`]; tests drive [`CloudClient`] against an in-memory fake.
//!
//! Production behavior is unchanged: [`CloudClient::new`] wires up
//! [`ReqwestTransport`] exactly as the old direct-reqwest code did.

use crate::{
    command_queue::{CommandOutcome, CommandQueue, PendingCommand},
    config::BridgeConfig,
};
use anyhow::Result;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::warn;

/// Self-describing identity the bridge sends with `claim` and `heartbeat`.
///
/// The backend `BridgeHeartbeatDto` / `ClaimBridgeDto` accept exactly
/// `hostname` / `os` / `agentVersion` (all optional), persisted on the
/// `LocalBridgeAgent` row so operators can see what's running where. We
/// serialize with `camelCase` to match the NestJS DTO field names and skip
/// `None` so the ValidationPipe whitelist doesn't see stray nulls.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeIdentity {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hostname: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_version: Option<String>,
}

impl BridgeIdentity {
    /// Best-effort self-description from the running process. `os` and
    /// `agent_version` are always known at compile time; `hostname` is
    /// looked up from the environment and is `None` on hosts that don't
    /// export it (the backend column is optional, so that's fine).
    pub fn detect() -> Self {
        Self {
            hostname: std::env::var("HOSTNAME").ok().filter(|s| !s.is_empty()),
            os: Some(std::env::consts::OS.to_string()),
            agent_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        }
    }
}

/// The provisioning-token → bearer-token exchange request body sent to
/// `POST /v1/bridges/claim`. `provisioningToken` is required; the identity
/// fields are flattened alongside it to match `ClaimBridgeDto`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimRequest {
    pub provisioning_token: String,
    #[serde(flatten)]
    pub identity: BridgeIdentity,
}

/// Decoded `POST /v1/bridges/claim` response. The backend returns
/// `{ bridgeId, tenantId, branchId, token, tokenExpiresAt }`; we only need
/// the bearer `token` (and surface `bridge_id` for logging), so the rest is
/// ignored via `#[serde(default)]`/skipped unknown fields.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimResponse {
    pub bridge_id: String,
    /// The long-lived bearer token to use as `Authorization: Bridge <token>`.
    pub token: String,
}

/// Result of a `commands/next` poll, decoded into plain data so the
/// queue-push logic in [`CloudClient::fetch_more`] is hardware/HTTP-free.
#[derive(Debug, Clone, PartialEq)]
pub enum FetchResponse {
    /// HTTP 204 — the cloud has nothing queued for us right now.
    NoContent,
    /// 2xx with a (possibly empty) batch of commands to enqueue.
    Commands(Vec<PendingCommand>),
    /// Any non-success status. Carried so the client can log it and move on
    /// without treating a transient 5xx as fatal.
    NonSuccess(u16),
    /// deep-review NH2/NH6: a 2xx whose body could not be decoded into a command
    /// batch (schema drift, truncated body, weird LAN proxy interstitial). This
    /// is NOT an empty batch — the cloud may actually have queued
    /// payment/print commands. Surfaced as its own variant so `fetch_more` can
    /// back off and leave the commands server-side for re-offer, instead of the
    /// old `unwrap_or_default()` which silently dropped the whole batch.
    DecodeError,
}

/// The transport seam over the cloud HTTP API.
///
/// Every method returns plain data, so the implementation can be the real
/// `reqwest` client ([`ReqwestTransport`]) or an in-memory fake. The trait is
/// object-safe so [`CloudClient`] can hold it as `Arc<dyn CloudTransport>` and
/// stay `Clone` (telemetry clones the client into its heartbeat task).
#[async_trait]
pub trait CloudTransport: Send + Sync {
    /// GET `/healthz`. Returns the HTTP status code.
    async fn get_healthz(&self) -> Result<u16>;

    /// GET `/v1/bridges/:id/commands/next`, decoded into a [`FetchResponse`].
    async fn get_next_commands(&self) -> Result<FetchResponse>;

    /// POST an outcome to `/v1/devices/commands/:id/ack`. Errors on a
    /// non-success HTTP status so the caller can retry/fail uniformly.
    async fn post_ack(&self, cmd_id: &str, outcome: &CommandOutcome) -> Result<()>;

    /// POST `/v1/bridges/heartbeat` with the bridge bearer token + identity.
    /// This is the call that keeps the bridge marked `online` cloud-side
    /// (60s grace). Errors on a non-success HTTP status so the caller can log
    /// it; the heartbeat loop treats failures as best-effort.
    async fn post_heartbeat(&self, identity: &BridgeIdentity) -> Result<()>;

    /// POST `/v1/bridges/claim` to exchange a one-shot provisioning token for
    /// a long-lived bearer token. Returns the decoded [`ClaimResponse`].
    /// Errors on a non-success HTTP status (e.g. an already-used token → 404).
    async fn post_claim(&self, req: &ClaimRequest) -> Result<ClaimResponse>;
}

#[derive(Clone)]
pub struct CloudClient {
    inner: Arc<Inner>,
}

struct Inner {
    transport: Arc<dyn CloudTransport>,
}

impl CloudClient {
    /// Production constructor — wires the real `reqwest`-backed transport.
    /// Behavior-preserving wrapper over [`ReqwestTransport::new`].
    pub fn new(cfg: BridgeConfig) -> Result<Self> {
        let transport = ReqwestTransport::new(cfg)?;
        Ok(Self::with_transport(Arc::new(transport)))
    }

    /// The seam: construct a client over any [`CloudTransport`]. Tests pass a
    /// fake; production passes [`ReqwestTransport`] via [`CloudClient::new`].
    pub fn with_transport(transport: Arc<dyn CloudTransport>) -> Self {
        Self {
            inner: Arc::new(Inner { transport }),
        }
    }

    /// Quick GET to confirm the cloud is reachable. Used at boot so the agent
    /// can switch to "offline mode" UI hints if the cloud is unavailable.
    pub async fn warm_up(&self) -> Result<()> {
        let status = self.inner.transport.get_healthz().await?;
        if !(200..300).contains(&status) {
            anyhow::bail!("cloud warm-up returned HTTP {}", status);
        }
        Ok(())
    }

    /// Pull more commands when the local queue is empty and enqueue them.
    ///
    /// 204 → nothing to do. Non-success → log and tolerate (a transient 5xx
    /// must not crash the agent). 2xx → push every returned command into the
    /// durable queue (dedup is the queue's job).
    pub async fn fetch_more(&self, queue: &CommandQueue) -> Result<()> {
        match self.inner.transport.get_next_commands().await? {
            FetchResponse::NoContent => Ok(()),
            FetchResponse::NonSuccess(status) => {
                warn!(status, "cloud fetch_more non-success");
                Ok(())
            }
            FetchResponse::DecodeError => {
                // deep-review NH2/NH6: do NOT treat an undecodable body as "no
                // work". Return Err so the main loop logs it and engages its 5s
                // backoff; the commands were never acked, so the cloud re-offers
                // them on the next poll instead of being silently lost.
                warn!("cloud fetch_more: undecodable command body — backing off, commands stay queued server-side");
                anyhow::bail!("undecodable commands/next body")
            }
            FetchResponse::Commands(commands) => {
                for c in commands {
                    queue.push(&c).await?;
                }
                Ok(())
            }
        }
    }

    /// Ack a completed command's outcome back to the cloud.
    pub async fn ack(&self, cmd: &PendingCommand, outcome: &CommandOutcome) -> Result<()> {
        self.inner.transport.post_ack(&cmd.id, outcome).await
    }

    /// Ack a failed command. Shapes the canonical `failed` outcome (null
    /// result + error string) and forwards it through [`CloudClient::ack`].
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

    /// Post a heartbeat to the cloud so the bridge stays `online`. This is the
    /// real liveness signal — distinct from [`CloudClient::warm_up`], which is
    /// only a one-shot boot reachability probe and never updates `lastSeenAt`.
    pub async fn post_heartbeat(&self, identity: &BridgeIdentity) -> Result<()> {
        self.inner.transport.post_heartbeat(identity).await
    }

    /// First-boot claim: exchange a provisioning token for a bearer token.
    /// Returns the decoded [`ClaimResponse`] (carrying the new bearer token).
    pub async fn claim(&self, provisioning_token: &str) -> Result<ClaimResponse> {
        let req = ClaimRequest {
            provisioning_token: provisioning_token.to_string(),
            identity: BridgeIdentity::detect(),
        };
        self.inner.transport.post_claim(&req).await
    }
}

// ---------------------------------------------------------------------------
// Real reqwest transport (thin HTTP adapter behind the seam).
// ---------------------------------------------------------------------------

/// Real `reqwest`-backed [`CloudTransport`]. Holds the HTTP client + the
/// config it needs to build URLs and auth headers. This is the only part of
/// the module that touches the network; everything above is HTTP-free and
/// unit-tested.
pub struct ReqwestTransport {
    cfg: BridgeConfig,
    http: reqwest::Client,
}

impl ReqwestTransport {
    pub fn new(cfg: BridgeConfig) -> Result<Self> {
        use anyhow::Context;
        // rustls / OS TLS root init can fail (e.g. malformed CA bundle on a
        // misconfigured host). Returning Result propagates the cause through
        // `main` instead of aborting the process.
        let http = reqwest::Client::builder()
            .https_only(true)
            // Conservative timeouts so a wedged proxy doesn't stall the agent.
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(10))
            .build()
            .context("build reqwest client")?;
        Ok(Self { cfg, http })
    }
}

#[async_trait]
impl CloudTransport for ReqwestTransport {
    async fn get_healthz(&self) -> Result<u16> {
        let url = format!("{}/healthz", self.cfg.cloud_url);
        let resp = self.http.get(url).send().await?;
        Ok(resp.status().as_u16())
    }

    async fn get_next_commands(&self) -> Result<FetchResponse> {
        let url = format!(
            "{}/v1/bridges/{}/commands/next",
            self.cfg.cloud_url, self.cfg.bridge_id
        );
        let token = crate::config::resolve_bearer_token().unwrap_or_default();
        let resp = self
            .http
            .get(url)
            .header("Authorization", format!("Bridge {}", token))
            .send()
            .await?;
        if resp.status().as_u16() == 204 {
            return Ok(FetchResponse::NoContent);
        }
        if !resp.status().is_success() {
            return Ok(FetchResponse::NonSuccess(resp.status().as_u16()));
        }
        // deep-review NH2/NH6: never `unwrap_or_default()` a command-bearing 2xx
        // body — that silently turned schema drift / a truncated body into "0
        // commands", losing whole batches of queued payment/print commands with
        // no log. Read the bytes (network error still propagates via `?`), then
        // decode explicitly and surface a decode failure as `DecodeError` so the
        // loop backs off and the commands remain server-side for re-offer.
        let body = resp.bytes().await?;
        match serde_json::from_slice::<Vec<PendingCommand>>(&body) {
            Ok(commands) => Ok(FetchResponse::Commands(commands)),
            Err(e) => {
                warn!(error = %e, len = body.len(), "commands/next body failed to decode; treating as fetch failure, not empty");
                Ok(FetchResponse::DecodeError)
            }
        }
    }

    async fn post_ack(&self, cmd_id: &str, outcome: &CommandOutcome) -> Result<()> {
        let url = format!("{}/v1/devices/commands/{}/ack", self.cfg.cloud_url, cmd_id);
        let token = crate::config::resolve_bearer_token().unwrap_or_default();
        self.http
            .post(url)
            .header("Authorization", format!("Bridge {}", token))
            .json(outcome)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    async fn post_heartbeat(&self, identity: &BridgeIdentity) -> Result<()> {
        let url = format!("{}/v1/bridges/heartbeat", self.cfg.cloud_url);
        let token = crate::config::resolve_bearer_token().unwrap_or_default();
        self.http
            .post(url)
            .header("Authorization", format!("Bridge {}", token))
            .json(identity)
            .send()
            .await?
            .error_for_status()?;
        Ok(())
    }

    async fn post_claim(&self, req: &ClaimRequest) -> Result<ClaimResponse> {
        // /v1/bridges/claim is @Public (no bearer yet — that's the whole
        // point of the exchange). error_for_status() turns an already-used
        // token (404) or a malformed request (400) into an Err the caller
        // logs; a success body is decoded into the bearer token.
        let url = format!("{}/v1/bridges/claim", self.cfg.cloud_url);
        let resp = self
            .http
            .post(url)
            .json(req)
            .send()
            .await?
            .error_for_status()?;
        let claim: ClaimResponse = resp.json().await?;
        Ok(claim)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex;
    use tempfile::TempDir;

    /// In-memory [`CloudTransport`]. Seed the canned responses; it records the
    /// acks it received so we can assert the exact outcome shape the client
    /// posted — without any network.
    #[derive(Default)]
    struct FakeTransport {
        healthz_status: u16,
        next: Mutex<Option<FetchResponse>>,
        acks: Mutex<Vec<(String, CommandOutcome)>>,
        /// If true, post_ack returns an error (simulates the cloud rejecting).
        ack_fails: bool,
        /// Identities received via post_heartbeat, so tests can assert the
        /// heartbeat tick actually posts (and what it posts).
        heartbeats: Mutex<Vec<BridgeIdentity>>,
        /// Provisioning tokens received via post_claim.
        claims: Mutex<Vec<String>>,
        /// If true, post_claim returns an error (simulates an invalid /
        /// already-used provisioning token → 4xx).
        claim_fails: bool,
    }

    impl FakeTransport {
        fn acks(&self) -> Vec<(String, CommandOutcome)> {
            self.acks.lock().unwrap().clone()
        }
        fn heartbeat_count(&self) -> usize {
            self.heartbeats.lock().unwrap().len()
        }
        fn claims(&self) -> Vec<String> {
            self.claims.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl CloudTransport for FakeTransport {
        async fn get_healthz(&self) -> Result<u16> {
            Ok(self.healthz_status)
        }
        async fn get_next_commands(&self) -> Result<FetchResponse> {
            Ok(self
                .next
                .lock()
                .unwrap()
                .clone()
                .unwrap_or(FetchResponse::NoContent))
        }
        async fn post_ack(&self, cmd_id: &str, outcome: &CommandOutcome) -> Result<()> {
            if self.ack_fails {
                anyhow::bail!("cloud rejected ack for {cmd_id}");
            }
            self.acks
                .lock()
                .unwrap()
                .push((cmd_id.to_string(), outcome.clone()));
            Ok(())
        }
        async fn post_heartbeat(&self, identity: &BridgeIdentity) -> Result<()> {
            self.heartbeats.lock().unwrap().push(identity.clone());
            Ok(())
        }
        async fn post_claim(&self, req: &ClaimRequest) -> Result<ClaimResponse> {
            if self.claim_fails {
                anyhow::bail!("cloud rejected claim (invalid/used provisioning token)");
            }
            self.claims
                .lock()
                .unwrap()
                .push(req.provisioning_token.clone());
            Ok(ClaimResponse {
                bridge_id: "bridge-xyz".to_string(),
                token: "bearer-from-claim".to_string(),
            })
        }
    }

    fn cmd(id: &str) -> PendingCommand {
        PendingCommand {
            id: id.to_string(),
            kind: "print_receipt".to_string(),
            payload: json!({ "target": "escpos" }),
            priority: 0,
            attempts: 0,
        }
    }

    fn client_with(t: FakeTransport) -> (CloudClient, Arc<FakeTransport>) {
        let arc = Arc::new(t);
        (CloudClient::with_transport(arc.clone()), arc)
    }

    #[tokio::test]
    async fn warm_up_ok_on_2xx() {
        let (client, _) = client_with(FakeTransport {
            healthz_status: 200,
            ..Default::default()
        });
        assert!(client.warm_up().await.is_ok());
    }

    #[tokio::test]
    async fn warm_up_errors_on_non_2xx() {
        let (client, _) = client_with(FakeTransport {
            healthz_status: 503,
            ..Default::default()
        });
        let err = client.warm_up().await.unwrap_err();
        assert!(err.to_string().contains("503"));
    }

    #[tokio::test]
    async fn fetch_more_pushes_returned_commands_into_the_queue() {
        // The load-bearing logic: a 2xx batch must land every command in the
        // durable queue, ready for the dispatch loop to pop.
        let dir = TempDir::new().unwrap();
        let queue = CommandQueue::open(dir.path().join("q.db")).unwrap();

        let (client, _) = client_with(FakeTransport {
            next: Mutex::new(Some(FetchResponse::Commands(vec![cmd("a"), cmd("b")]))),
            ..Default::default()
        });

        client.fetch_more(&queue).await.unwrap();

        // Both commands should now be poppable from the queue.
        let first = queue.pop_next().await.unwrap().expect("first queued");
        let second = queue.pop_next().await.unwrap().expect("second queued");
        let mut ids = [first.id, second.id];
        ids.sort();
        assert_eq!(ids, ["a".to_string(), "b".to_string()]);
        assert!(queue.pop_next().await.unwrap().is_none(), "only two pushed");
    }

    #[tokio::test]
    async fn fetch_more_no_content_pushes_nothing() {
        let dir = TempDir::new().unwrap();
        let queue = CommandQueue::open(dir.path().join("q.db")).unwrap();
        let (client, _) = client_with(FakeTransport {
            next: Mutex::new(Some(FetchResponse::NoContent)),
            ..Default::default()
        });

        client.fetch_more(&queue).await.unwrap();
        assert!(queue.pop_next().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn fetch_more_tolerates_non_success_without_erroring() {
        // A transient 503 must NOT bubble an error (that would crash the loop)
        // and must enqueue nothing.
        let dir = TempDir::new().unwrap();
        let queue = CommandQueue::open(dir.path().join("q.db")).unwrap();
        let (client, _) = client_with(FakeTransport {
            next: Mutex::new(Some(FetchResponse::NonSuccess(503))),
            ..Default::default()
        });

        client
            .fetch_more(&queue)
            .await
            .expect("non-success is tolerated, not fatal");
        assert!(queue.pop_next().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn fetch_more_errors_on_decode_failure_and_enqueues_nothing() {
        // deep-review NH2/NH6: an undecodable 2xx body must NOT look like "no
        // work". fetch_more returns Err (so main.rs backs off) and queues nothing
        // — the commands stay server-side for re-offer rather than being lost.
        let dir = TempDir::new().unwrap();
        let queue = CommandQueue::open(dir.path().join("q.db")).unwrap();
        let (client, _) = client_with(FakeTransport {
            next: Mutex::new(Some(FetchResponse::DecodeError)),
            ..Default::default()
        });

        let err = client
            .fetch_more(&queue)
            .await
            .expect_err("decode failure must surface as Err, not silent empty");
        assert!(err.to_string().contains("undecodable"));
        assert!(
            queue.pop_next().await.unwrap().is_none(),
            "nothing enqueued on decode failure"
        );
    }

    #[tokio::test]
    async fn ack_forwards_outcome_verbatim() {
        let (client, fake) = client_with(FakeTransport::default());
        let outcome = CommandOutcome {
            status: "done".to_string(),
            result: json!({ "ok": true }),
            error: None,
        };
        client.ack(&cmd("c-1"), &outcome).await.unwrap();

        let acks = fake.acks();
        assert_eq!(acks.len(), 1);
        assert_eq!(acks[0].0, "c-1");
        assert_eq!(acks[0].1.status, "done");
        assert_eq!(acks[0].1.result, json!({ "ok": true }));
    }

    #[tokio::test]
    async fn ack_failed_shapes_the_failed_outcome() {
        // ack_failed must construct status="failed", null result, and carry the
        // error string — this is the shape the cloud's retry policy reads.
        let (client, fake) = client_with(FakeTransport::default());
        client
            .ack_failed(&cmd("c-2"), "printer offline")
            .await
            .unwrap();

        let acks = fake.acks();
        assert_eq!(acks.len(), 1);
        assert_eq!(acks[0].0, "c-2");
        assert_eq!(acks[0].1.status, "failed");
        assert_eq!(acks[0].1.result, serde_json::Value::Null);
        assert_eq!(acks[0].1.error.as_deref(), Some("printer offline"));
    }

    #[tokio::test]
    async fn ack_propagates_transport_errors() {
        let (client, _) = client_with(FakeTransport {
            ack_fails: true,
            ..Default::default()
        });
        let err = client
            .ack(
                &cmd("c-3"),
                &CommandOutcome {
                    status: "done".to_string(),
                    result: serde_json::Value::Null,
                    error: None,
                },
            )
            .await
            .unwrap_err();
        assert!(err.to_string().contains("c-3"));
    }

    #[tokio::test]
    async fn post_heartbeat_forwards_identity_to_the_transport() {
        // M8: the heartbeat tick must reach the cloud (not just /healthz). A
        // single post_heartbeat call records exactly one identity payload.
        let (client, fake) = client_with(FakeTransport::default());
        let identity = BridgeIdentity {
            hostname: Some("box-01".to_string()),
            os: Some("linux".to_string()),
            agent_version: Some("9.9.9".to_string()),
        };
        client.post_heartbeat(&identity).await.unwrap();

        let beats = fake.heartbeats.lock().unwrap();
        assert_eq!(fake.heartbeat_count(), 1);
        assert_eq!(beats[0].hostname.as_deref(), Some("box-01"));
        assert_eq!(beats[0].agent_version.as_deref(), Some("9.9.9"));
    }

    #[tokio::test]
    async fn claim_exchanges_provisioning_token_for_bearer() {
        // M9: claim posts the provisioning token once and returns the new
        // bearer token from the response body.
        let (client, fake) = client_with(FakeTransport::default());
        let resp = client.claim("prov-token-123").await.unwrap();

        assert_eq!(resp.token, "bearer-from-claim");
        assert_eq!(resp.bridge_id, "bridge-xyz");
        assert_eq!(fake.claims(), vec!["prov-token-123".to_string()]);
    }

    #[tokio::test]
    async fn claim_propagates_transport_errors() {
        // An invalid / already-used provisioning token (4xx) must surface as
        // an Err so main.rs can log it and continue in offline mode rather
        // than pretending it has a bearer.
        let (client, _) = client_with(FakeTransport {
            claim_fails: true,
            ..Default::default()
        });
        let err = client.claim("bad-token").await.unwrap_err();
        assert!(err.to_string().contains("rejected claim"));
    }

    #[test]
    fn bridge_identity_detect_fills_os_and_version() {
        // detect() always knows os + agentVersion at compile time; hostname is
        // best-effort. The serialized JSON must use camelCase to match the
        // NestJS ClaimBridgeDto / BridgeHeartbeatDto field names.
        let id = BridgeIdentity::detect();
        assert!(id.os.is_some(), "os is known from std::env::consts::OS");
        assert_eq!(id.agent_version.as_deref(), Some(env!("CARGO_PKG_VERSION")));

        let json = serde_json::to_value(&BridgeIdentity {
            hostname: None,
            os: Some("linux".to_string()),
            agent_version: Some("1.2.3".to_string()),
        })
        .unwrap();
        // camelCase + None hostname skipped (no stray null for the whitelist).
        assert_eq!(json["agentVersion"], "1.2.3");
        assert_eq!(json["os"], "linux");
        assert!(json.get("hostname").is_none());
    }
}

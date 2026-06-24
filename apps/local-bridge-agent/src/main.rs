//! HummyTummy Local Bridge Agent — entrypoint.
//!
//! The agent runs as a long-lived process. Responsibilities split:
//!   - [`cloud_ws`]: persistent WSS to the cloud + REST fallback.
//!   - [`command_queue`]: SQLite-backed durable command FIFO with backoff.
//!   - [`drivers`]: per-device-class executors (escpos / yazarkasa / …).
//!   - [`offline_cache`]: menu + open orders snapshot for offline ops.
//!   - [`telemetry`]: heartbeat + structured logs to the cloud.
//!   - [`updater`]: signed-manifest auto-update channel.
//!
//! Order of operations on startup:
//!   1. Load config (cloud URL, bearer token from OS keyring).
//!   2. Initialise the local SQLite (`command_queue.db`).
//!   3. Spawn driver tasks and bring them to "idle".
//!   4. Open the WSS to the cloud. On failure, fall back to REST polling.
//!   5. Run the main event loop: drain queue → execute → ack → repeat.

use anyhow::Result;
use clap::Parser;
use hummytummy_local_bridge::{cloud_ws, command_queue, config, drivers, health, telemetry};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(version, about = "HummyTummy Local Bridge Agent", long_about = None)]
struct Cli {
    /// Path to the config directory. Defaults to $XDG_CONFIG_HOME or platform-equivalent.
    #[arg(long)]
    config_dir: Option<String>,

    /// Run a one-shot health-check and exit.
    #[arg(long)]
    health: bool,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    // Structured JSON logs to stderr by default; honor RUST_LOG.
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .json()
        .init();

    let cli = Cli::parse();
    info!(version = env!("CARGO_PKG_VERSION"), "bridge starting");

    let cfg = config::load(cli.config_dir.as_deref())?;
    if cli.health {
        return health::run(&cfg).await;
    }

    // The command queue is the single source of truth for "what does this
    // bridge owe?". It outlives the cloud connection, so the agent keeps
    // working through transient internet outages.
    // Arc-wrapped so a low-frequency retention sweep can run alongside the main
    // loop without moving the queue. open() also runs crash recovery (NH1/NH4):
    // inflight rows orphaned by a previous crash are requeued (safe kinds) or
    // parked in needs_review (money/fiscal kinds).
    let queue = std::sync::Arc::new(command_queue::CommandQueue::open(
        cfg.data_dir.join("command_queue.db"),
    )?);

    // deep-review NM2: bounded retention sweep on a low-frequency cadence so the
    // SQLite file does not grow without bound (eventually disk-full → all new
    // charges/prints fail). Drops only fully-settled rows (acked/failed) older
    // than 48h and reclaims pages via incremental_vacuum.
    let _sweep_handle = {
        let q = queue.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(std::time::Duration::from_secs(3600));
            const RETENTION_MS: i64 = 48 * 3600 * 1000;
            loop {
                tick.tick().await;
                match q.sweep(RETENTION_MS).await {
                    Ok(n) if n > 0 => info!(swept = n, "command_queue retention sweep"),
                    Ok(_) => {}
                    Err(e) => warn!(error = %e, "command_queue retention sweep failed"),
                }
            }
        })
    };
    // Surface any rows parked for human reconciliation at boot so a stranded
    // charge/fiscal receipt is operator-visible rather than silent (NH1).
    match queue.needs_review_count().await {
        Ok(n) if n > 0 => warn!(
            needs_review = n,
            "command_queue: commands parked for reconciliation (likely interrupted money/fiscal ops)"
        ),
        _ => {}
    }

    // The drivers registry resolves device kinds → executors at runtime.
    // A driver that fails to initialise (e.g. printer not yet wired) is
    // logged but does NOT block the agent boot.
    let drivers = drivers::Registry::init(&cfg.data_dir).await?;
    info!(
        installed = drivers.installed_kinds().join(","),
        "drivers initialised"
    );

    // Cloud transport. WSS is the primary channel; REST polling is fallback.
    let cloud = cloud_ws::CloudClient::new(cfg.clone())?;
    if let Err(e) = cloud.warm_up().await {
        warn!(error = %e, "cloud warm-up failed — agent continues in offline mode");
    }

    // Spawn telemetry heartbeat in the background. Handle is intentionally
    // detached — the task runs for the lifetime of the agent and is torn
    // down on process exit. Prefixed `_` so clippy doesn't flag it under
    // -D warnings.
    let _heartbeat_handle = telemetry::spawn_heartbeat(cloud.clone());

    // Main loop: retry outstanding acks, then pull next queued command,
    // dispatch, ack.
    loop {
        // deep-review NH3/NH7: an executed-but-unacked command is NOT settled.
        // Before fetching new work, drain any outcomes that were persisted by a
        // previous dispatch but whose ack failed (network blip / 5xx / crash
        // before ack). Without this, the cloud still considers the command
        // outstanding and re-issues it — often under a NEW command id that the
        // local INSERT-OR-IGNORE dedup misses — re-executing the charge/print.
        for (acked_cmd, outcome) in queue.pending_acks(32).await? {
            match cloud.ack(&acked_cmd, &outcome).await {
                Ok(()) => queue.mark_acked(&acked_cmd.id).await?,
                Err(e) => {
                    warn!(cmd = %acked_cmd.id, error = %e, "ack retry failed — outcome still not confirmed to cloud");
                    // Leave the row in 'done' so it is retried on the next pass.
                    // Back off so we don't spin while the cloud is unreachable.
                    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                    break;
                }
            }
        }

        if let Some(cmd) = queue.pop_next().await? {
            match drivers.dispatch(&cmd).await {
                Ok(outcome) => {
                    // Persist the outcome first (durable), THEN ack. On ack
                    // failure the row stays 'done' and the pending-acks drain
                    // above retries it — never silently lose the outcome.
                    queue.mark_done(&cmd.id, &outcome).await?;
                    match cloud.ack(&cmd, &outcome).await {
                        Ok(()) => queue.mark_acked(&cmd.id).await?,
                        Err(e) => {
                            warn!(cmd = %cmd.id, error = %e, "ack failed — outcome persisted, will retry");
                        }
                    }
                }
                Err(e) => {
                    warn!(cmd = %cmd.id, error = %e, "command failed");
                    // mark_failed is kind-aware: side-effecting (money/fiscal)
                    // kinds are parked in 'needs_review' here rather than
                    // requeued, so the ack_failed below does not race a retry.
                    queue.mark_failed(&cmd.id, &e.to_string()).await?;
                    if let Err(ack_err) = cloud.ack_failed(&cmd, &e.to_string()).await {
                        warn!(cmd = %cmd.id, error = %ack_err, "ack_failed not confirmed to cloud");
                    }
                }
            }
        } else if let Err(e) = cloud.fetch_more(&queue).await {
            // No work locally → pull more from the cloud. On error, back off
            // briefly so we don't hammer the API.
            warn!(error = %e, "cloud fetch failed");
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
        tokio::task::yield_now().await;
    }

    // (background task handles drop with the process; the OS reclaims them.)
    #[allow(unreachable_code)]
    {
        drop(_heartbeat_handle);
        drop(_sweep_handle);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::Cli;
    use clap::Parser;

    // `Cli::parse_from` exercises the exact clap configuration used by the
    // binary at runtime (the `#[derive(Parser)]` + `#[arg(...)]` attributes),
    // so these assertions pin the CLI surface the systemd unit and operators
    // depend on. arg[0] is the program name, as clap expects.

    #[test]
    fn defaults_when_no_flags_given() {
        let cli = Cli::parse_from(["bridge"]);
        assert!(cli.config_dir.is_none());
        assert!(!cli.health);
    }

    #[test]
    fn parses_config_dir_flag() {
        let cli = Cli::parse_from(["bridge", "--config-dir", "/etc/hummy"]);
        assert_eq!(cli.config_dir.as_deref(), Some("/etc/hummy"));
        assert!(!cli.health);
    }

    #[test]
    fn health_flag_is_a_boolean_switch() {
        let cli = Cli::parse_from(["bridge", "--health"]);
        assert!(cli.health);
        assert!(cli.config_dir.is_none());
    }

    #[test]
    fn combined_flags_parse_together() {
        let cli = Cli::parse_from(["bridge", "--config-dir", "/srv/cfg", "--health"]);
        assert_eq!(cli.config_dir.as_deref(), Some("/srv/cfg"));
        assert!(cli.health);
    }

    #[test]
    fn unknown_flag_is_rejected() {
        // try_parse_from returns Err on an unrecognised flag — the binary
        // would print usage and exit non-zero. Confirms clap is wired strict.
        let res = Cli::try_parse_from(["bridge", "--nope"]);
        assert!(res.is_err());
    }
}

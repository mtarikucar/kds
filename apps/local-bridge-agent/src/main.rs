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
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
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
    let queue = command_queue::CommandQueue::open(&cfg.data_dir.join("command_queue.db"))?;

    // The drivers registry resolves device kinds → executors at runtime.
    // A driver that fails to initialise (e.g. printer not yet wired) is
    // logged but does NOT block the agent boot.
    let drivers = drivers::Registry::init().await?;
    info!(
        installed = drivers.installed_kinds().join(","),
        "drivers initialised"
    );

    // Cloud transport. WSS is the primary channel; REST polling is fallback.
    let cloud = cloud_ws::CloudClient::new(cfg.clone());
    if let Err(e) = cloud.warm_up().await {
        warn!(error = %e, "cloud warm-up failed — agent continues in offline mode");
    }

    // Spawn telemetry heartbeat in the background.
    let heartbeat_handle = telemetry::spawn_heartbeat(cloud.clone());

    // Main loop: pull next queued command, dispatch, ack.
    loop {
        if let Some(cmd) = queue.pop_next().await? {
            match drivers.dispatch(&cmd).await {
                Ok(outcome) => {
                    queue.mark_done(&cmd.id, &outcome).await?;
                    let _ = cloud.ack(&cmd, &outcome).await;
                }
                Err(e) => {
                    warn!(cmd = %cmd.id, error = %e, "command failed");
                    queue.mark_failed(&cmd.id, &e.to_string()).await?;
                    let _ = cloud.ack_failed(&cmd, &e.to_string()).await;
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

    // (heartbeat_handle drops with the process; the OS reclaims it.)
    #[allow(unreachable_code)]
    {
        drop(heartbeat_handle);
        Ok(())
    }
}

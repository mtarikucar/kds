//! Configuration loading.
//!
//! The bridge reads `bridge.toml` from its config directory. Bearer tokens
//! are stored in the OS keyring (linux: secret-tool, macos: Keychain,
//! windows: DPAPI); the file holds only non-secret config.
//!
//! For MVP and CI we accept the token via environment variable too —
//! HUMMY_BRIDGE_TOKEN — so headless deploys don't need a keyring. Production
//! should always use the keyring.

use anyhow::{Context, Result};
use serde::Deserialize;
use std::{
    env,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Deserialize)]
pub struct BridgeConfig {
    /// Base URL of the HummyTummy cloud API, e.g. https://api.hummytummy.com
    pub cloud_url: String,
    /// Bridge identifier issued by the cloud at claim time.
    pub bridge_id: String,
    /// Provisioning token (one-shot) — only used on first boot.
    #[serde(default)]
    pub provisioning_token: Option<String>,
    /// Data directory for the SQLite queue + offline cache.
    pub data_dir: PathBuf,
}

pub fn load(config_dir: Option<&str>) -> Result<BridgeConfig> {
    let cfg_dir = config_dir
        .map(PathBuf::from)
        .or_else(dirs_config_dir)
        .context("unable to determine config dir")?;
    let cfg_path = cfg_dir.join("bridge.toml");
    let s = std::fs::read_to_string(&cfg_path)
        .with_context(|| format!("read config {}", cfg_path.display()))?;
    let cfg: BridgeConfig = toml::from_str(&s).context("parse bridge.toml")?;
    std::fs::create_dir_all(&cfg.data_dir).ok();
    Ok(cfg)
}

/// Token resolution: env var beats keyring. Never logged.
pub fn resolve_bearer_token() -> Option<String> {
    env::var("HUMMY_BRIDGE_TOKEN").ok()
    // TODO: keyring lookup via the `keyring` crate, gated by a feature so
    // unit tests don't need a keyring service running.
}

fn dirs_config_dir() -> Option<PathBuf> {
    if let Ok(xdg) = env::var("XDG_CONFIG_HOME") {
        return Some(Path::new(&xdg).join("hummytummy"));
    }
    if let Ok(home) = env::var("HOME") {
        return Some(Path::new(&home).join(".config/hummytummy"));
    }
    None
}

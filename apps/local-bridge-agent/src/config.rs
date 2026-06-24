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

/// Persist a bearer token issued by a successful first-boot claim so the rest
/// of this process (and, ideally, subsequent boots) authenticate without the
/// provisioning token.
///
/// Today we set the in-process `HUMMY_BRIDGE_TOKEN` env var, which is exactly
/// the slot [`resolve_bearer_token`] reads first — so every authenticated call
/// for the remainder of this run (heartbeat, commands/next, ack) immediately
/// picks it up. The token is written to the same place a headless deploy would
/// supply it, keeping a single source of truth.
///
/// NOTE: this is in-process only and does NOT survive a restart. The durable
/// store is the OS keyring (the same TODO that gates [`resolve_bearer_token`]):
/// once the `keyring` crate is wired behind its feature flag, this function
/// should also write the bearer to the keyring so a re-boot resolves it without
/// re-claiming. Until then, headless deploys should set `HUMMY_BRIDGE_TOKEN`
/// from the claim output, or accept that a single-use provisioning token can
/// only be claimed once (the server invalidates it on first claim).
pub fn persist_bearer_token(token: &str) -> Result<()> {
    if token.is_empty() {
        anyhow::bail!("refusing to persist an empty bearer token");
    }
    // SAFETY/threading: called once, on the single-threaded tokio runtime,
    // during first-boot bootstrap before any other task reads the token.
    env::set_var("HUMMY_BRIDGE_TOKEN", token);
    Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    // Env-var-driven helpers (`dirs_config_dir`, `resolve_bearer_token`) read
    // process-global state. Cargo runs tests in the same process on multiple
    // threads, so we keep ALL env mutation inside a single #[test] that
    // saves/restores the variables it touches, avoiding cross-test races.

    /// RAII guard that restores an env var to its prior value (or unsets it)
    /// when dropped — so a panic mid-test can't leak state into other tests.
    struct EnvGuard {
        key: &'static str,
        prev: Option<String>,
    }

    impl EnvGuard {
        fn set(key: &'static str, val: &str) -> Self {
            let prev = env::var(key).ok();
            env::set_var(key, val);
            Self { key, prev }
        }
        fn unset(key: &'static str) -> Self {
            let prev = env::var(key).ok();
            env::remove_var(key);
            Self { key, prev }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(v) => env::set_var(self.key, v),
                None => env::remove_var(self.key),
            }
        }
    }

    #[test]
    fn bridge_config_parses_from_toml() {
        // The on-disk bridge.toml carries only non-secret config; the bearer
        // token lives in the keyring/env. Confirm the documented shape and the
        // #[serde(default)] on provisioning_token both hold.
        let toml_src = r#"
            cloud_url = "https://api.hummytummy.com"
            bridge_id = "bridge-abc123"
            data_dir = "/var/lib/hummy-bridge"
        "#;
        let cfg: BridgeConfig = toml::from_str(toml_src).expect("valid toml");
        assert_eq!(cfg.cloud_url, "https://api.hummytummy.com");
        assert_eq!(cfg.bridge_id, "bridge-abc123");
        assert_eq!(cfg.data_dir, PathBuf::from("/var/lib/hummy-bridge"));
        // Optional, omitted in the file -> None (one-shot provisioning only).
        assert!(cfg.provisioning_token.is_none());
    }

    #[test]
    fn bridge_config_parses_optional_provisioning_token() {
        let toml_src = r#"
            cloud_url = "https://api.example.com"
            bridge_id = "b1"
            provisioning_token = "one-shot-secret"
            data_dir = "/tmp/x"
        "#;
        let cfg: BridgeConfig = toml::from_str(toml_src).expect("valid toml");
        assert_eq!(cfg.provisioning_token.as_deref(), Some("one-shot-secret"));
    }

    #[test]
    fn bridge_config_rejects_missing_required_field() {
        // cloud_url is required (no serde default) — parsing must fail rather
        // than booting the agent against an empty URL.
        let toml_src = r#"
            bridge_id = "b1"
            data_dir = "/tmp/x"
        "#;
        let parsed: Result<BridgeConfig, _> = toml::from_str(toml_src);
        assert!(parsed.is_err(), "missing cloud_url should be a parse error");
    }

    #[test]
    fn env_var_resolution_for_token_and_config_dir() {
        // --- resolve_bearer_token: env var present ---
        let _tok = EnvGuard::set("HUMMY_BRIDGE_TOKEN", "secret-token");
        assert_eq!(resolve_bearer_token().as_deref(), Some("secret-token"));
        drop(_tok); // token restored/unset before the "absent" check below

        let _tok_absent = EnvGuard::unset("HUMMY_BRIDGE_TOKEN");
        assert!(resolve_bearer_token().is_none());
        drop(_tok_absent);

        // --- dirs_config_dir: XDG_CONFIG_HOME wins over HOME ---
        let _xdg = EnvGuard::set("XDG_CONFIG_HOME", "/xdg/conf");
        let _home = EnvGuard::set("HOME", "/home/user");
        assert_eq!(
            dirs_config_dir(),
            Some(PathBuf::from("/xdg/conf/hummytummy")),
            "XDG_CONFIG_HOME must take precedence"
        );
        drop(_xdg);

        // --- dirs_config_dir: falls back to HOME/.config/hummytummy ---
        let _xdg_absent = EnvGuard::unset("XDG_CONFIG_HOME");
        assert_eq!(
            dirs_config_dir(),
            Some(PathBuf::from("/home/user/.config/hummytummy")),
            "without XDG_CONFIG_HOME, fall back to HOME/.config"
        );
        drop(_home);

        // --- dirs_config_dir: neither set -> None ---
        let _home_absent = EnvGuard::unset("HOME");
        assert!(
            dirs_config_dir().is_none(),
            "no XDG_CONFIG_HOME and no HOME -> cannot resolve a config dir"
        );
    }
}

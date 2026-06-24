# HummyTummy Local Bridge Agent

A small Rust daemon that runs on the restaurant LAN (mini-PC, Tauri-hosted side-car, or — eventually — Raspberry-Pi-class device).

## Why it exists

Three classes of restaurant peripheral cannot be driven from the public internet:

1. **Yazarkasa / fiscal printers** — refuse internet routing by design; talk LAN + serial only.
2. **Receipt printers (ESC/POS)** — usually on a local subnet behind NAT.
3. **POS terminals** — acquirer-bound, LAN-side only.

The bridge is HummyTummy's only authorised speaker on that LAN. It:

- Holds bearer-token credentials issued by the cloud (sha256-stored at the server).
- Maintains a persistent WSS to the cloud (heartbeat every 20s).
- Pulls device commands from `device_commands` and dispatches them to local drivers.
- Buffers commands to a local SQLite queue when offline; replays on reconnect.
- Pushes device events, logs, and acks back to the cloud.

## Lifecycle (registration)

1. The buyer's hardware ships with a one-shot **provisioning token** (`base64url`).
2. On first boot, the bridge POSTs `/v1/bridges/claim { provisioningToken, hostname, os, agentVersion }`.
3. The cloud returns a long-lived **bearer token** (kept in OS keyring).
4. The bridge opens a WSS to `/ws/bridge` and identifies itself with the bearer.
5. Every 20s the bridge POSTs `/v1/bridges/heartbeat`. After 60s of silence the cloud flips the bridge `offline`.

## Driver architecture

```
agent ── command_queue ──┬── escpos.rs       (Epson TM/Star TSP)
                         ├── yazarkasa_*.rs  (Hugin, Beko, Profilo, …)
                         ├── ingenico_iwl.rs (card-present terminal)
                         └── (...)
```

Each driver implements a tiny trait `LocalDriver { execute(&self, cmd) -> Result<Outcome> }` so the rest of the agent never branches on brand. Adding a new driver is one file + one entry in the registry.

## Build

```sh
cargo build --release
# Strips down to ~6–8 MB for x86_64-unknown-linux-gnu.
```

## Security model

- Bearer tokens are stored in OS keyring (`secret-tool` on Linux, DPAPI on Windows, Tauri Stronghold when hosted in the desktop app).
- Provisioning tokens are sha256-hashed at the server; the raw token is shown to the operator exactly once.
- The bridge **never exposes** a WAN-side port. Local-only ports: `:8443` (mTLS to tablets) and `:1883` (MQTT, LAN-only bind).
- All cloud traffic is HTTPS/WSS with rustls + webpki-roots; no custom CA bundling.
- A signed update manifest pinned at compile time gates auto-updates.

## What ships in this scaffold

This commit lands the workspace boilerplate, command queue, and one driver (`escpos`). The cloud transport is wired end-to-end: first-boot **claim** (`POST /v1/bridges/claim`, exchanging the provisioning token for a bearer), a real 20s **heartbeat** (`POST /v1/bridges/heartbeat`, which is what keeps the bridge `online`), and `commands/next` + ack. The yazarkasa and ingenico drivers are stubbed; their `execute` methods return `not_implemented` so a real device test surfaces immediately.

> Persistence caveat: a claimed bearer token is currently kept only in-process (via `HUMMY_BRIDGE_TOKEN`) for the life of the daemon. Durable cross-boot storage in the OS keyring is still a TODO (`config::persist_bearer_token` / `resolve_bearer_token`); until it lands, a headless restart needs `HUMMY_BRIDGE_TOKEN` set, because the provisioning token is single-use server-side.

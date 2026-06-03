# HummyTummy KDS Kiosk

A Tauri-shelled React app that runs on a kitchen-mounted touch screen and renders order tickets coming out of the Device Mesh.

## What it does

1. On first boot, asks the operator for an API URL + a 6-character pair code (printed by the admin dashboard when a `kds_screen` device slot is created).
2. POSTs to `/v1/devices/pair`, receives a long-lived bearer token, stores it in the OS keyring.
3. Heartbeats every 20s and polls `/v1/devices/next-command` every 2s.
4. Renders `show_order` commands as ticket cards; clears them on `clear_order` or the operator's bump.

## Build

```sh
cd apps/kds-kiosk
npm install
npm run tauri:dev          # dev mode
npm run tauri:build        # production bundle for the host OS
```

For cross-platform builds (Windows kiosk PC / Mac dev / ARM mini-PC) see the parent project's `desktop/` README — the toolchain instructions are identical.

## Architecture

```
       OS keyring                   /v1/devices/*
            │                              │
            ▼                              ▼
     ┌──────────┐    ipc    ┌─────────────────────────┐
     │ Tauri    │  ───────  │ React UI (Vite + RQ)    │
     │ (Rust)   │           │ - PairingScreen         │
     │  - load_ │           │ - KitchenScreen         │
     │  - save_ │           │   (poll loop, ticket    │
     │  token   │           │    grid, heartbeat)     │
     └──────────┘           └─────────────────────────┘
```

- **Rust side** is intentionally minimal: 2 commands (`load_device_token` / `save_device_token`) over IPC. All cloud I/O is in the React layer.
- **Keyring** stores the bearer token under `com.hummytummy.kds-kiosk` / `device-token` so it survives reboots and is not readable by other apps.

## Pairing flow

```
admin dashboard                 kiosk                            cloud
        │                          │                               │
        │ create kds_screen slot   │                               │
        │─────────────────────────►│                               │
        │   pairCode "A4F9K2"      │                               │
        │                          │ operator enters A4F9K2        │
        │                          │ POST /v1/devices/pair         │
        │                          │──────────────────────────────►│
        │                          │       { token, deviceId }     │
        │                          │◄──────────────────────────────│
        │                          │ keyring.set(token)            │
        │                          │ ✓ pair done                   │
```

## What it does NOT do (yet)

- WSS push (uses 2s REST polling). WSS support lands when the gateway is wired.
- Print a kitchen ticket on the local printer — that's the Local Bridge Agent's job; the kiosk only renders.
- Audio alerts for new orders (planned).
- Offline cache (planned — cloud-side has the snapshot endpoint ready).

## Bundling for production

Each kiosk SKU (21" / 27" touch screens listed in the hardware catalogue) ships pre-flashed with this binary. The flashing pipeline is part of the order-fulfilment workflow — see `docs/api/hummytummy-v1.md` for the device-pairing API.

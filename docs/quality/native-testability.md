# Native Components — Testability Map

Track: **wave-t1/native-test-harness** (Quality-attributes hardening program).

This document records, per native component, what is **unit-testable** (pure
logic that runs in CI on any box with no special hardware) versus what is
**hardware-in-the-loop** (HIL — requires real cameras, GPUs, BLE adapters, or
payment terminals and therefore belongs to integration testing, not unit
testing). It also documents the seams where a hardware dependency should be
abstracted behind a trait so the pure logic around it can be faked.

The goal of this track is **testability**, not coverage-for-its-own-sake: make
the pure logic addressable by a unit test, add real (non-vacuous) assertions,
and mark the rest honestly as HIL.

---

## Summary table

| Component | Language | Unit-testable pure logic | Test harness | HIL / integration-only |
|---|---|---|---|---|
| `desktop/src-tauri` | Rust | hardware config parse/merge, `DeviceStatus` state transitions, ESC/POS byte encoding + CP-857 transcode | `#[cfg(test)] mod tests` (in-crate) | BLE scan/connect/write (btleplug), Tauri event emit |
| `apps/local-bridge-agent` | Rust | config TOML parse, env-var resolution, CLI arg parse, driver-registry routing, SQLite command-queue FIFO/retry | `#[cfg(test)] mod tests` + `tests/` integration | real printer / yazarkasa / Ingenico I/O, cloud WSS/REST |
| `edge-device-cpp` | C++ | CLI `parse_args`, `Config::merge_env`/`from_env`/`validate`/`to_json` | standalone `tests/CMakeLists.txt` + assert-based runner | CUDA, TensorRT, GStreamer/RTSP, OpenCV, WebSocket |
| `segmentation-service` | (none) | — | — | empty stub: only `requirements.txt`, no source code to test |

---

## desktop/src-tauri (Rust, Tauri POS desktop app)

### Unit-testable (pure logic — has `#[cfg(test)] mod tests`)

- **`hardware/config.rs`** — `HardwareConfig` / `DeviceConfig` serde round-trip,
  tagged-union connection shape, `#[serde(default)]` behavior. *(pre-existing
  tests; left as-is)*
- **`hardware/status.rs`** — `DeviceStatus::from_config` (fresh device starts
  `Disconnected`/`Unknown`), and the `mark_connected` / `mark_disconnected` /
  `mark_error` state machine. **Tests added in this track.**
  - **Clock injection:** `mark_connected()` previously called `Utc::now()`
    inline, which is untestable (non-deterministic timestamp). It now delegates
    to a new `mark_connected_at(now: DateTime<Utc>)` that takes an **injected
    clock**; the public method passes `Utc::now()` so runtime behavior is
    byte-identical, while tests assert the exact stamped instant. This is the
    recommended pattern for the other `Utc::now()` sites listed under HIL below.
- **`escpos/mod.rs`** — `PrinterCommand::to_bytes()` produces the exact ESC/POS
  wire bytes (Initialize → `ESC @` + `ESC t 13`, barcodes stay ASCII, etc.).
  *(pre-existing tests)*
- **`escpos/codepage.rs`** — UTF-8 → CP-857 Turkish transcoder, including the
  dotted/dotless-I distinction and the `?` fallback. *(pre-existing tests)*
- **`bluetooth.rs`** — `PrinterCommand` byte test. **Fixed in this track:** the
  assertion for `Initialize` was stale (`[0x1B, 0x40]`) and predated the CP-857
  fix; it now asserts the real current output `[0x1B, 0x40, 0x1B, 0x74, 13]`.
  This is a test-only correction — production `to_bytes()` was already correct.

### Hardware-in-the-loop / integration-only

- **`bluetooth.rs` `BluetoothManager`** — `scan_devices`, `connect_device`,
  `write_characteristic`, `read_characteristic`, `print` all drive a real BLE
  adapter via `btleplug`. **Seam to abstract:** introduce a `BleTransport`
  trait (methods: `scan`, `connect`, `disconnect`, `write`, `read`) and make
  `BluetoothManager` generic over it. The current `Peripheral`/`Adapter` calls
  become the production impl; a `FakeBleTransport` then lets the orchestration
  logic (UUID parse, connected-device bookkeeping, the per-command 50 ms feed
  loop in `print`) be unit-tested without a radio. The `connection/` submodule
  is already scaffolded as the home for this `Connection`-trait abstraction.
  *(Not done in this track — flagged as the next seam; the existing test
  `test_bluetooth_manager_creation` only asserts "doesn't panic" and is
  inherently host-dependent.)*
- **`hardware/events.rs`** — `emit` pushes to Tauri's `AppHandle` event bus; the
  payload enum (`HardwareEvent`) is pure serde and could be round-trip tested,
  but the emit itself needs a running Tauri app. Multiple `Utc::now()` call
  sites in `main.rs` (event timestamps) should take an injected clock the same
  way `status.rs` now does.

### Build note
`cargo test` for `desktop/src-tauri` could **not** be run end-to-end in this
environment: the Tauri 1.5 dependency tree fails to compile here due to a
pre-existing transitive conflict between `alloc_no_stdlib` v2/v3 pulled in via
`brotli-decompressor` (unrelated to any code in scope). To validate the new
`status.rs` tests + the clock-injection refactor, the pure modules
(`hardware/config.rs` + `hardware/status.rs`) were copied **verbatim** into a
throwaway crate depending only on serde/serde_json/chrono/thiserror/dirs, and
`cargo test` there passed all 7 tests (3 pre-existing config + 4 new status).
The blocker is the Tauri build, not the unit-test logic.

---

## apps/local-bridge-agent (Rust, LAN ↔ cloud bridge)

### Unit-testable (pure logic)

- **`config.rs`** — **Tests added in this track:** `BridgeConfig` TOML parse
  (required vs optional fields, `provisioning_token` default), and the
  env-var resolution helpers `resolve_bearer_token()` (env beats keyring) and
  `dirs_config_dir()` (XDG_CONFIG_HOME precedence → HOME fallback → None). Env
  mutation is serialized into one test with an RAII `EnvGuard` to avoid
  cross-test races on the process-global environment.
- **`main.rs` (`Cli`)** — **Tests added in this track:** clap arg parsing via
  `Cli::parse_from` / `try_parse_from` (defaults, `--config-dir`, `--health`
  switch, combined flags, rejection of unknown flags). Lives in a `#[cfg(test)]`
  module inside `main.rs` since `Cli` is binary-private.
- **`drivers/mod.rs` (`Registry::dispatch`)** — **Tests added in this track:**
  command routing by the payload `target` field, using a `FakeDriver`
  implementing the `LocalDriver` trait (the **trait is the hardware seam** —
  real drivers do printer/POS I/O; the fake records call counts). Covers:
  routes to the matching driver, picks the right one among several, errors on
  unknown/missing target, and `installed_kinds()`.
- **`command_queue.rs`** — durable SQLite FIFO with priority ordering, push
  idempotency on id, the 5-attempt retry cap (`mark_failed` requeues then goes
  terminal), and persistence across handle reopen. *(pre-existing integration
  tests in `tests/command_queue_integration.rs`)*

### Hardware-in-the-loop / integration-only

- **`drivers/escpos.rs`, `drivers/yazarkasa_hugin.rs`, `drivers/ingenico_iwl.rs`**
  — real device I/O behind the `LocalDriver` trait. The trait is exactly the
  seam: pure routing/queueing is unit-tested with fakes; the concrete drivers
  are exercised only against physical hardware. (They are currently stubs.)
- **`cloud_ws.rs`** — `reqwest`/WSS to the cloud; needs a live (or mocked HTTP)
  endpoint. URL construction is pure and could be extracted, but the
  send/receive paths are integration.
- **`telemetry.rs` / `updater.rs`** — background heartbeat loop and
  signed-manifest update; network + process-replacement, integration-only.
- **Time:** `command_queue::chrono_unix_now()` reads `SystemTime::now()`. For
  fully deterministic queue tests, this should take an injected clock (same
  pattern as `status.rs`); today the integration tests assert ordering/cap
  invariants that don't depend on the absolute timestamp.

### Build note
`cargo test` for `apps/local-bridge-agent` **was run successfully** in this
environment:
- `cargo test --lib --bins` → **14 passed** (9 lib: 4 config + 5 drivers;
  5 bin: CLI parse).
- `cargo test --test command_queue_integration` → **5 passed** (pre-existing,
  still green).

---

## edge-device-cpp (C++, Jetson/TensorRT computer-vision edge box)

### Unit-testable (pure logic)

- **`parse_args` (extracted to `src/args.cpp` / `src/args.hpp`)** — the CLI
  parser was **extracted verbatim** from `main.cpp` (which otherwise can't be
  linked into a test without CUDA/TensorRT/GStreamer/OpenCV) into the `kds`
  namespace, and `main.cpp` now calls `kds::parse_args` / `kds::print_usage`.
  Behavior is byte-identical. Covered: defaults, value flags, boolean switches,
  `--help`/`-h`, dangling value flags (the `i+1 < argc` guard), unknown-flag
  pass-through, combined invocation.
- **`Config::merge_env` / `Config::from_env` / `Config::validate` /
  `Config::to_json`** — pure functions of the process environment + the
  `Config`'s own fields. Covered: env vars override file values (env precedence),
  absent env vars leave fields untouched, typed parsing in `from_env`, every
  required-field-empty validation failure, the confidence-threshold range
  check, and `to_json` field round-trip. (`Config::load` is **not** unit-tested
  — it reads a YAML file off disk and is exercised by integration tests.)

### Test harness
A **separate, lightweight** `edge-device-cpp/tests/CMakeLists.txt` —
deliberately decoupled from the top-level `CMakeLists.txt`, which requires CUDA,
OpenCV, GStreamer, and TensorRT. The test project compiles only `args.cpp`,
`config.cpp`, and `utils/logger.cpp`, fetching `spdlog`, `yaml-cpp`, and
`nlohmann/json` (header/lib-only) via `FetchContent`. Tests are assert-based (a
tiny `CHECK` macro in `tests/test_util.hpp`, no gtest/doctest vendoring needed);
the runner returns non-zero if any check fails so `ctest` reports correctly.

```sh
cmake -S edge-device-cpp/tests -B edge-device-cpp/build   # build/ is gitignored
cmake --build edge-device-cpp/build
ctest --test-dir edge-device-cpp/build --output-on-failure
```

### Hardware-in-the-loop / integration-only

- **`detection/yolo_tensorrt.{hpp,cpp}`** — TensorRT engine build + GPU
  inference. Pure NMS/IoU helpers exist in `utils/nms.{hpp,cpp}` but they
  operate on `cv::Rect2f` (OpenCV types), so unit-testing them pulls in OpenCV;
  candidate for a follow-up that links a minimal OpenCV-core-only test target.
  The detector itself is HIL (CUDA + TensorRT). **Seam:** define a `Detector`
  interface (`detect(frame) -> vector<Detection>`) so the tracker + homography
  pipeline can be tested with a fake detector emitting canned boxes.
- **`camera/rtsp_client.{hpp,cpp}`** — GStreamer RTSP capture; HIL (a live
  camera or an RTSP test server). **Seam:** a `FrameSource` interface.
- **`detection/tracker.{hpp,cpp}`** — IoU/Kalman tracker. The math is pure but
  state-heavy and OpenCV-typed; a strong follow-up unit-test candidate once an
  OpenCV-core test link is added (feed synthetic detection sequences, assert
  track lifecycle: confirm after `min_hits`, age out after `max_age`).
- **`calibration/homography.{hpp,cpp}`** — image→floor projection; pure linear
  algebra but OpenCV-typed (`cv::Mat`); same follow-up bucket as tracker/NMS.
- **`communication/websocket_client.{hpp,cpp}`** — websocketpp + JWT to the
  backend; integration-only.

### Build note
The C++ unit tests **were built and run successfully** in this environment:
`ctest` reports `100% tests passed`, and the runner reports **54/54 checks
passed** (27 for `parse_args`, 27 for `Config`). The `[error]` log lines printed
during the run are the expected output of `validate()` rejecting empty fields —
they confirm the failure paths are genuinely exercised. The full edge binary was
**not** built (it needs CUDA/TensorRT/GStreamer/OpenCV, absent here); only the
pure-logic test target was built, which is the point of decoupling it.

---

## segmentation-service

**Empty stub.** The directory contains **only `requirements.txt`** (Python ML
dependencies: torch, SAM-2, GroundingDINO, supervision, fastapi, etc.). There is
**no source code** — no modules, no entrypoint, nothing to unit-test. When the
service is implemented, mirror the pattern above: keep pure logic (mask/polygon
geometry, config parsing, request/response schemas) separable from the
GPU-bound model inference, and unit-test the pure layer with fixtures while the
inference path stays integration/HIL. Until then, this component is
intentionally out of scope for a test harness.

---

## What could / could not be run in this environment

| Component | Built? | Tests run? | Result |
|---|---|---|---|
| `apps/local-bridge-agent` (lib + bins) | yes | yes | 14 passed |
| `apps/local-bridge-agent` (integration) | yes | yes | 5 passed |
| `edge-device-cpp` pure-logic test target | yes | yes | 54/54 checks, ctest 100% |
| `desktop/src-tauri` (full `cargo test`) | **no** | no | blocked: pre-existing Tauri/`brotli-decompressor` `alloc_no_stdlib` v2-vs-v3 conflict (unrelated to changes) |
| `desktop/src-tauri` pure modules (verbatim-copy harness) | yes | yes | 7 passed (validates the new `status.rs` tests + clock-injection refactor) |
| `segmentation-service` | n/a | n/a | empty stub, no code |

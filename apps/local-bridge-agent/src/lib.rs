//! Library entry point — re-exports the modules main.rs declares so that
//! integration tests under `tests/` can use them without depending on a
//! binary build.
//!
//! Cargo treats a crate as both a `bin` and a `lib` automatically when both
//! `src/main.rs` and `src/lib.rs` exist; the binary picks up its imports
//! through `hummytummy_local_bridge::*` once main.rs is updated.

pub mod cloud_ws;
pub mod command_queue;
pub mod config;
pub mod drivers;
pub mod health;
pub mod offline_cache;
pub mod telemetry;
pub mod updater;

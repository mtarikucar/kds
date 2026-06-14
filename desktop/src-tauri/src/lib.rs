//! Library target for the desktop app's hardware/Bluetooth logic.
//!
//! ## Why a `lib` target exists
//!
//! The binary (`main.rs`) invokes `tauri::generate_context!()`, a compile-time
//! macro that reads the built frontend bundle (`../dist`) and the app icons.
//! That makes the *binary* test harness impossible to build without first
//! running the full frontend build + asset pipeline — which is unavailable in
//! a bare checkout / CI worktree.
//!
//! The hardware logic, however, has nothing to do with that macro. Exposing
//! the same modules through a plain `lib` target lets `cargo test --lib`
//! compile and run the unit tests (`bluetooth`, `hardware::config`,
//! `hardware::status`) with zero Tauri context, zero icons, zero `dist/`.
//!
//! This is the standard Tauri project layout (Tauri 2 scaffolds it by
//! default). It is behavior-preserving: `main.rs` still declares its own copy
//! of these modules for the binary, so production code paths are unchanged.

pub mod bluetooth;
pub mod escpos;
pub mod hardware;

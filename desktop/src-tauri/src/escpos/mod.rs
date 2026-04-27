//! ESC/POS thermal-printer command construction.
//!
//! This module is being built incrementally as part of Phase 1.3
//! (see docs/superpowers/plans/2026-04-27-phase-1-3-tauri-hardware-suite.md).
//!
//! Today: the CP-857 transcoder for Turkish receipt printing
//! (Bug E from the reliability audit). The PrinterCommand enum and the
//! receipt/kitchen-ticket templates land in subsequent commits — they
//! depend on the bluetooth.rs → hardware/connection/ refactor (Sub-phase
//! 1.3.A) which itself depends on a clean `cargo check` build.

pub mod codepage;

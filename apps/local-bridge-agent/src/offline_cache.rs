//! Offline cache for menu, open orders, and last-known device state.
//!
//! Stored in the same SQLite file as the command queue but in separate
//! tables. The cloud snapshots these at intervals and pushes the latest
//! payload at bridge claim/heartbeat.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

pub struct OfflineCache {
    // Held but not yet read — the bridge currently only creates the schema
    // at startup (in `open` below). Readers + writers land alongside the
    // first feature that needs the cache (Phase 6 — offline order replay).
    // Until then we keep the connection alive so the file handle outlives
    // this struct's caller and SQLite WAL flushes happen on Drop.
    #[allow(dead_code)]
    conn: std::sync::Mutex<Connection>,
}

impl OfflineCache {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Connection::open(path.as_ref())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS snapshots (
                key TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );",
        )?;
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
        })
    }
}

//! Offline cache for menu, open orders, and last-known device state.
//!
//! Stored in the same SQLite file as the command queue but in separate
//! tables. The cloud snapshots these at intervals and pushes the latest
//! payload at bridge claim/heartbeat.

use anyhow::Result;
use rusqlite::Connection;
use std::path::Path;

pub struct OfflineCache {
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
        Ok(Self { conn: std::sync::Mutex::new(conn) })
    }
}

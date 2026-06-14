//! Durable command queue backed by SQLite.
//!
//! Why SQLite: the bridge must survive crashes, reboots, and 24h offline
//! windows. Embedded Postgres is too heavy; in-memory queues lose data; flat
//! files lack transactional semantics. SQLite hits the sweet spot — zero
//! dependencies, transactional, and small.
//!
//! Schema is intentionally narrow — the cloud is the source of truth for
//! the full command shape; the bridge only stores what it needs to execute
//! and ack.

use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PendingCommand {
    pub id: String,
    pub kind: String,
    pub payload: serde_json::Value,
    pub priority: i32,
    pub attempts: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandOutcome {
    pub status: String, // "done" | "failed"
    pub result: serde_json::Value,
    pub error: Option<String>,
}

pub struct CommandQueue {
    // Mutex is fine here — the queue is a low-throughput coordination point.
    // If we ever need higher concurrency, a Tokio mpsc channel layered on top
    // would slot in without changing the API.
    conn: Mutex<Connection>,
}

impl CommandQueue {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Connection::open(path.as_ref())?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS commands (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                payload TEXT NOT NULL,
                priority INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'queued',
                attempts INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_commands_queue
              ON commands (status, priority DESC, created_at);",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub async fn push(&self, cmd: &PendingCommand) -> Result<()> {
        let conn = self.conn.lock().expect("queue mutex poisoned");
        let now = chrono_unix_now();
        conn.execute(
            "INSERT OR IGNORE INTO commands
              (id, kind, payload, priority, status, attempts, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 'queued', 0, ?5, ?5)",
            params![
                cmd.id,
                cmd.kind,
                serde_json::to_string(&cmd.payload)?,
                cmd.priority,
                now,
            ],
        )?;
        Ok(())
    }

    pub async fn pop_next(&self) -> Result<Option<PendingCommand>> {
        let conn = self.conn.lock().expect("queue mutex poisoned");
        // Atomically claim the next queued command. SQLite serialises, so
        // race conditions are impossible at this point.
        let mut stmt = conn.prepare(
            "UPDATE commands
                SET status = 'inflight',
                    attempts = attempts + 1,
                    updated_at = ?1
              WHERE id = (SELECT id FROM commands
                           WHERE status = 'queued'
                           ORDER BY priority DESC, created_at
                           LIMIT 1)
            RETURNING id, kind, payload, priority, attempts",
        )?;
        let now = chrono_unix_now();
        let mut rows = stmt.query(params![now])?;
        if let Some(row) = rows.next()? {
            let payload_s: String = row.get(2)?;
            return Ok(Some(PendingCommand {
                id: row.get(0)?,
                kind: row.get(1)?,
                payload: serde_json::from_str(&payload_s)?,
                priority: row.get(3)?,
                attempts: row.get(4)?,
            }));
        }
        Ok(None)
    }

    pub async fn mark_done(&self, id: &str, outcome: &CommandOutcome) -> Result<()> {
        let conn = self.conn.lock().expect("queue mutex poisoned");
        conn.execute(
            "UPDATE commands SET status = 'done', error = NULL, updated_at = ?2 WHERE id = ?1",
            params![id, chrono_unix_now()],
        )?;
        // outcome is forwarded to the cloud; we keep only minimal local state
        // to avoid bloating the SQLite file with completed payloads.
        let _ = outcome;
        Ok(())
    }

    pub async fn mark_failed(&self, id: &str, error: &str) -> Result<()> {
        let conn = self.conn.lock().expect("queue mutex poisoned");
        // 5-attempt cap matches the cloud-side retry policy.
        conn.execute(
            "UPDATE commands
                SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
                    error = ?2,
                    updated_at = ?3
              WHERE id = ?1",
            params![id, error, chrono_unix_now()],
        )?;
        Ok(())
    }
}

fn chrono_unix_now() -> i64 {
    // Deliberate small helper instead of pulling in chrono crate.
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

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

/// Money/fiscal substrings that mark a command kind as side-effecting. Shared
/// by `is_side_effecting` (mark_failed) AND `side_effecting_sql`
/// (recover()/pop_next()) so the three classifiers can NEVER diverge — a
/// `charge_card` parked by one but auto-retried by another is exactly the
/// double-charge this guards.
const MONEY_TOKENS: &[&str] = &["payment", "charge", "refund", "void", "reversal", "fiscal"];

/// SQL predicate (on column `kind`) equivalent to `is_side_effecting`, built
/// from MONEY_TOKENS so recover()/pop_next() stay in lockstep with mark_failed.
fn side_effecting_sql() -> String {
    MONEY_TOKENS
        .iter()
        .map(|tok| format!("kind LIKE '%{tok}%'"))
        .collect::<Vec<_>>()
        .join(" OR ")
}

/// deep-review NH1/NH4/NH5/NM1: a side-effecting command (card charge, fiscal
/// receipt, refund) must NEVER be auto-re-executed without an idempotency
/// guarantee — re-running it double-charges the customer or double-prints a
/// legally-binding fiscal receipt. Until the driver/acquirer layer carries an
/// idempotency key end-to-end, these kinds are parked in `needs_review` instead
/// of being requeued.
///
/// Matched by SUBSTRING on money/fiscal tokens, not exact strings: the cloud
/// enqueues concrete kinds like `charge_card`, `void_card`, `fiscal_cancel`,
/// `fiscal_report` (payment-terminal P1–P4), which an exact-match list silently
/// let slip back onto the auto-retry path. Erring toward over-matching is the
/// safe direction — a false positive only parks a benign command for review;
/// a false negative double-charges a customer.
fn is_side_effecting(kind: &str) -> bool {
    MONEY_TOKENS.iter().any(|tok| kind.contains(tok))
}

/// Lease TTL for inflight rows. A dispatch that has held a command longer than
/// this is treated as wedged/dead and reclaimed by the runtime reaper in
/// `pop_next`. Chosen longer than the cloud HTTP timeout (30s in cloud_ws) so a
/// merely-slow-but-alive dispatch is not stolen out from under itself.
const INFLIGHT_LEASE_MS: i64 = 60_000;

pub struct CommandQueue {
    // Mutex is fine here — the queue is a low-throughput coordination point.
    // If we ever need higher concurrency, a Tokio mpsc channel layered on top
    // would slot in without changing the API.
    conn: Mutex<Connection>,
}

impl CommandQueue {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self> {
        let conn = Connection::open(path.as_ref())?;
        // deep-review NL1 + NM2: durability + contention hygiene, set BEFORE the
        // first table is created so auto_vacuum takes effect on a fresh DB.
        //   - WAL + synchronous=FULL: a committed status survives power loss, so
        //     reboot does not silently re-open the double-execute window.
        //   - busy_timeout: tolerate transient SQLITE_BUSY instead of dropping a
        //     command if a second connection ever shares this file.
        //   - auto_vacuum=INCREMENTAL: lets sweep() reclaim file pages so the DB
        //     does not grow without bound on a busy restaurant.
        // journal_mode/auto_vacuum return a row, so they must go through
        // execute_batch / pragma_query rather than conn.execute().
        conn.execute_batch(
            "PRAGMA auto_vacuum = INCREMENTAL;
             PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA busy_timeout = 5000;",
        )?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS commands (
                id TEXT PRIMARY KEY,
                kind TEXT NOT NULL,
                payload TEXT NOT NULL,
                priority INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'queued',
                attempts INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                result TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_commands_queue
              ON commands (status, priority DESC, created_at);",
        )?;
        // Migration for DBs created before the `result` column existed (so the
        // outcome can be persisted for durable, restart-surviving acks — NH3/NH7).
        // ALTER ... ADD COLUMN errors if it already exists; ignore that case.
        let _ = conn.execute("ALTER TABLE commands ADD COLUMN result TEXT", []);

        let queue = Self {
            conn: Mutex::new(conn),
        };
        queue.recover()?;
        Ok(queue)
    }

    /// deep-review NH1/NH4: crash-recovery sweep. A power cut or kill between
    /// `pop_next` (which sets status='inflight') and `mark_done` leaves a row
    /// stranded in 'inflight' forever — `pop_next`'s `WHERE status='queued'`
    /// never re-selects it, so the charge/print is silently lost with no signal.
    ///
    /// Kind-aware on purpose (NH4 step 3): re-executing a payment/fiscal command
    /// could double-charge or double-print, so those go to a terminal
    /// `needs_review` state for human reconciliation, surfaced to the cloud.
    /// Side-effect-free kinds (e.g. escpos order tickets) are safe to retry and
    /// go back to 'queued', still bounded by the same 5-attempt cap as
    /// `mark_failed` so a poison command can't loop forever.
    fn recover(&self) -> Result<()> {
        let conn = self.conn.lock().expect("queue mutex poisoned");
        let now = chrono_unix_now();
        // Money/fiscal kinds: park, do NOT auto-requeue. Uses the shared
        // side_effecting_sql() so the concrete cloud kinds (charge_card,
        // void_card, fiscal_cancel, fiscal_report) — which the old hardcoded
        // IN-list silently let slip onto the requeue path — are parked too.
        let parked = conn.execute(
            &format!(
                "UPDATE commands
                    SET status = 'needs_review',
                        error = COALESCE(error, 'recovered from inflight after restart — needs reconciliation'),
                        updated_at = ?1
                  WHERE status = 'inflight'
                    AND ({})",
                side_effecting_sql()
            ),
            params![now],
        )?;
        // Safe-to-retry kinds: requeue, honouring the 5-attempt cap.
        let requeued = conn.execute(
            "UPDATE commands
                SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
                    error = COALESCE(error, 'recovered from inflight after restart'),
                    updated_at = ?1
              WHERE status = 'inflight'",
            params![now],
        )?;
        if parked > 0 || requeued > 0 {
            tracing::warn!(
                parked_needs_review = parked,
                requeued,
                "command_queue: recovered inflight rows orphaned by a previous crash/reboot"
            );
        }
        Ok(())
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
        let now = chrono_unix_now();
        let lease_cutoff = now - INFLIGHT_LEASE_MS;
        // Atomically claim the next queued command. SQLite serialises, so
        // race conditions are impossible at this point.
        //
        // deep-review NH4 step 2: also reclaim a wedged-but-alive dispatch whose
        // inflight lease has expired (process hung past INFLIGHT_LEASE_MS without
        // dying), so a stuck dispatch is recovered without waiting for a restart.
        // Side-effecting (money/fiscal) kinds are deliberately EXCLUDED from
        // lease reclaim — re-popping them could double-charge; they stay inflight
        // and are surfaced/parked at next startup recovery or via reconciliation.
        let reclaim_sql = format!(
            "UPDATE commands
                SET status = 'inflight',
                    attempts = attempts + 1,
                    updated_at = ?1
              WHERE id = (SELECT id FROM commands
                           WHERE status = 'queued'
                              OR (status = 'inflight'
                                  AND updated_at < ?2
                                  AND NOT ({}))
                           ORDER BY priority DESC, created_at
                           LIMIT 1)
            RETURNING id, kind, payload, priority, attempts",
            side_effecting_sql()
        );
        let mut stmt = conn.prepare(&reclaim_sql)?;
        let mut rows = stmt.query(params![now, lease_cutoff])?;
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

    /// Mark a command as executed locally, AWAITING cloud ack.
    ///
    /// deep-review NH3/NH7: the ack is part of the durable command lifecycle, not
    /// fire-and-forget. We move to an intermediate `done` (= executed, ack
    /// pending) state and PERSIST the outcome (previously dropped via
    /// `let _ = outcome`), so if connectivity drops right after a charge the
    /// outcome survives a restart and the ack can be retried — instead of the
    /// cloud reissuing the logical charge under a new id and double-charging.
    /// `mark_acked` later moves `done` → `acked` once the cloud confirms.
    pub async fn mark_done(&self, id: &str, outcome: &CommandOutcome) -> Result<()> {
        let conn = self.conn.lock().expect("queue mutex poisoned");
        conn.execute(
            "UPDATE commands SET status = 'done', error = ?2, result = ?3, updated_at = ?4 WHERE id = ?1",
            params![
                id,
                outcome.error,
                serde_json::to_string(&outcome.result)?,
                chrono_unix_now()
            ],
        )?;
        Ok(())
    }

    /// deep-review NH3/NH7: terminal state reached only once the cloud has
    /// confirmed the ack. A row is "settled" (eligible for retention sweep) only
    /// after this transition; until then it is replayable via `pending_acks`.
    pub async fn mark_acked(&self, id: &str) -> Result<()> {
        let conn = self.conn.lock().expect("queue mutex poisoned");
        conn.execute(
            "UPDATE commands SET status = 'acked', updated_at = ?2 WHERE id = ?1",
            params![id, chrono_unix_now()],
        )?;
        Ok(())
    }

    /// deep-review NH3/NH7: rows executed successfully but not yet confirmed by
    /// the cloud (status='done', i.e. ack pending). The main loop drains this and
    /// retries the ack so a successful charge/print outcome is never lost on a
    /// connectivity blip — preventing the cloud from reissuing the logical
    /// command under a fresh id and double-executing it. Returns each command
    /// with its PERSISTED outcome so the exact original outcome is re-acked
    /// (never a freshly-fabricated one).
    pub async fn pending_acks(&self, limit: i64) -> Result<Vec<(PendingCommand, CommandOutcome)>> {
        let conn = self.conn.lock().expect("queue mutex poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, kind, payload, priority, attempts, status, error, result
               FROM commands
              WHERE status = 'done'
              ORDER BY updated_at
              LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |row| {
            let payload_s: String = row.get(2)?;
            let status: String = row.get(5)?;
            let error: Option<String> = row.get(6)?;
            let result_s: Option<String> = row.get(7)?;
            Ok((
                PendingCommand {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    payload: serde_json::from_str(&payload_s).unwrap_or(serde_json::Value::Null),
                    priority: row.get(3)?,
                    attempts: row.get(4)?,
                },
                CommandOutcome {
                    // a `done` row was executed successfully; the ack outcome is
                    // "done" regardless of the (null) error column.
                    status,
                    result: result_s
                        .and_then(|s| serde_json::from_str(&s).ok())
                        .unwrap_or(serde_json::Value::Null),
                    error,
                },
            ))
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub async fn mark_failed(&self, id: &str, error: &str) -> Result<()> {
        let conn = self.conn.lock().expect("queue mutex poisoned");
        // deep-review NM1/NH5: kind-aware requeue. A side-effecting command
        // (payment/fiscal/refund) that returned Err may ALREADY have performed
        // its side effect on the device (the classic ACK-timeout-after-card-
        // captured case). Auto-requeuing it would double-charge / double-print.
        // So such kinds go straight to a terminal `needs_review` state for human
        // reconciliation, regardless of attempts. Only idempotent/side-effect-
        // free kinds keep the original 5-attempt auto-retry policy.
        let kind: Option<String> = conn
            .query_row(
                "SELECT kind FROM commands WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .ok();
        let now = chrono_unix_now();
        if kind.as_deref().map(is_side_effecting).unwrap_or(false) {
            conn.execute(
                "UPDATE commands SET status = 'needs_review', error = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, error, now],
            )?;
        } else {
            // 5-attempt cap matches the cloud-side retry policy.
            conn.execute(
                "UPDATE commands
                    SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
                        error = ?2,
                        updated_at = ?3
                  WHERE id = ?1",
                params![id, error, now],
            )?;
        }
        Ok(())
    }

    /// deep-review NM2: bounded retention sweep. Deletes terminal rows older than
    /// `max_age_ms` and reclaims file pages, so command_queue.db does not grow
    /// without bound on a busy restaurant (eventually disk-full → all new
    /// charges/prints fail). Only fully-settled rows are eligible:
    ///   - `acked`: executed AND cloud-confirmed — safe to drop.
    ///   - `failed`: terminal failure, already attempted to ack.
    ///
    /// `done` (ack still pending) and `needs_review` (awaiting human action) are
    /// deliberately retained until they reach a settled state.
    pub async fn sweep(&self, max_age_ms: i64) -> Result<usize> {
        let conn = self.conn.lock().expect("queue mutex poisoned");
        let cutoff = chrono_unix_now() - max_age_ms;
        let n = conn.execute(
            "DELETE FROM commands WHERE status IN ('acked','failed') AND updated_at < ?1",
            params![cutoff],
        )?;
        conn.execute_batch("PRAGMA incremental_vacuum;")?;
        Ok(n)
    }

    /// deep-review NH1: count of rows parked for human reconciliation, so the
    /// main loop can surface them to the cloud/operator via telemetry.
    pub async fn needs_review_count(&self) -> Result<i64> {
        let conn = self.conn.lock().expect("queue mutex poisoned");
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM commands WHERE status = 'needs_review'",
            [],
            |row| row.get(0),
        )?;
        Ok(n)
    }
}

fn chrono_unix_now() -> i64 {
    // Deliberate small helper instead of pulling in chrono crate.
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    fn cmd(id: &str, kind: &str) -> PendingCommand {
        PendingCommand {
            id: id.to_string(),
            kind: kind.to_string(),
            payload: json!({ "target": "escpos" }),
            priority: 0,
            attempts: 0,
        }
    }

    fn done_outcome() -> CommandOutcome {
        CommandOutcome {
            status: "done".to_string(),
            result: json!({ "ok": true }),
            error: None,
        }
    }

    /// deep-review NH1/NH4: reopening the queue must reclaim orphaned inflight
    /// rows — but kind-aware: a side-effect-free row becomes re-poppable while a
    /// money/fiscal row lands in `needs_review` (never auto-re-executed).
    #[tokio::test]
    async fn recover_requeues_safe_kinds_but_parks_money_kinds() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("q.db");
        {
            let q = CommandQueue::open(&path).unwrap();
            q.push(&cmd("safe", "print_receipt")).await.unwrap();
            // Concrete cloud card kind — the old hardcoded IN-list omitted it.
            q.push(&cmd("money", "charge_card")).await.unwrap();
            // Claim both → both go 'inflight'.
            q.pop_next().await.unwrap().unwrap();
            q.pop_next().await.unwrap().unwrap();
            assert!(q.pop_next().await.unwrap().is_none(), "both inflight");
        }
        // Simulate a crash + restart by reopening the same DB file.
        let q = CommandQueue::open(&path).unwrap();
        // Money row must NOT be re-poppable; it is parked for reconciliation.
        let popped = q.pop_next().await.unwrap().expect("safe row re-poppable");
        assert_eq!(popped.id, "safe");
        assert!(
            q.pop_next().await.unwrap().is_none(),
            "money row must not be requeued"
        );
        assert_eq!(q.needs_review_count().await.unwrap(), 1);
    }

    /// deep-review NM1/NH5: a failed side-effecting command must NOT return to
    /// 'queued' (which would double-charge); it goes to terminal needs_review.
    #[tokio::test]
    async fn failed_money_command_is_parked_not_requeued() {
        let dir = TempDir::new().unwrap();
        let q = CommandQueue::open(dir.path().join("q.db")).unwrap();
        q.push(&cmd("pay1", "pos_charge")).await.unwrap();
        let c = q.pop_next().await.unwrap().unwrap();
        q.mark_failed(&c.id, "ack timeout after card captured")
            .await
            .unwrap();
        assert!(
            q.pop_next().await.unwrap().is_none(),
            "failed money command must not be re-popped"
        );
        assert_eq!(q.needs_review_count().await.unwrap(), 1);
    }

    /// The concrete payment-terminal / fiscal command kinds the cloud actually
    /// enqueues MUST classify as side-effecting (parked, never auto-retried).
    /// An exact-match list silently let `charge_card`/`void_card`/`fiscal_*`
    /// slip onto the retry path — a double-charge waiting for live hardware.
    #[test]
    fn payment_and_fiscal_command_kinds_are_side_effecting() {
        for kind in [
            "charge_card",
            "void_card",
            "fiscal_receipt",
            "fiscal_cancel",
            "fiscal_report",
            "pos_charge",
            "refund",
            "reversal",
        ] {
            assert!(is_side_effecting(kind), "{kind} must be side-effecting");
        }
        for kind in [
            "print_receipt",
            "show_order",
            "open_drawer",
            "noop",
            "capability_probe",
        ] {
            assert!(!is_side_effecting(kind), "{kind} must be auto-retryable");
        }
    }

    /// A failed `charge_card` (the real card-terminal kind) is parked, not
    /// requeued — the end-to-end double-charge guard once hardware is live.
    #[tokio::test]
    async fn failed_charge_card_is_parked_not_requeued() {
        let dir = TempDir::new().unwrap();
        let q = CommandQueue::open(dir.path().join("q.db")).unwrap();
        q.push(&cmd("cc1", "charge_card")).await.unwrap();
        let c = q.pop_next().await.unwrap().unwrap();
        q.mark_failed(&c.id, "ack lost after card captured")
            .await
            .unwrap();
        assert!(
            q.pop_next().await.unwrap().is_none(),
            "failed charge_card must not be re-popped"
        );
        assert_eq!(q.needs_review_count().await.unwrap(), 1);
    }

    /// A failed idempotent command keeps the original 5-attempt auto-retry.
    #[tokio::test]
    async fn failed_safe_command_requeues_until_cap() {
        let dir = TempDir::new().unwrap();
        let q = CommandQueue::open(dir.path().join("q.db")).unwrap();
        q.push(&cmd("p1", "print_receipt")).await.unwrap();
        // First failure → back to queued, re-poppable.
        let c = q.pop_next().await.unwrap().unwrap();
        q.mark_failed(&c.id, "printer offline").await.unwrap();
        assert!(
            q.pop_next().await.unwrap().is_some(),
            "safe command requeues"
        );
    }

    /// deep-review NH3/NH7: mark_done persists the outcome and leaves the row in
    /// a non-terminal 'done' state surfaced by pending_acks until mark_acked.
    #[tokio::test]
    async fn outcome_is_durable_until_acked() {
        let dir = TempDir::new().unwrap();
        let q = CommandQueue::open(dir.path().join("q.db")).unwrap();
        q.push(&cmd("c1", "print_receipt")).await.unwrap();
        let c = q.pop_next().await.unwrap().unwrap();
        q.mark_done(&c.id, &done_outcome()).await.unwrap();

        let pending = q.pending_acks(10).await.unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].0.id, "c1");
        assert_eq!(pending[0].1.result, json!({ "ok": true }));

        q.mark_acked("c1").await.unwrap();
        assert!(
            q.pending_acks(10).await.unwrap().is_empty(),
            "acked row no longer pending"
        );
    }

    /// deep-review NM2: sweep removes settled rows past the cutoff but leaves
    /// queued/inflight/needs_review/ack-pending rows untouched.
    #[tokio::test]
    async fn sweep_removes_only_old_settled_rows() {
        let dir = TempDir::new().unwrap();
        let q = CommandQueue::open(dir.path().join("q.db")).unwrap();
        q.push(&cmd("acked1", "print_receipt")).await.unwrap();
        q.push(&cmd("queued1", "print_receipt")).await.unwrap();
        // Drive acked1 to the terminal 'acked' state.
        let c = q.pop_next().await.unwrap().unwrap();
        // pop_next is priority/created ordered; ensure we acted on acked1.
        q.mark_done(&c.id, &done_outcome()).await.unwrap();
        q.mark_acked(&c.id).await.unwrap();

        // max_age_ms=-1 makes every row "older than cutoff" (cutoff in future).
        let removed = q.sweep(-1).await.unwrap();
        assert_eq!(removed, 1, "only the acked row is swept");
        // The still-queued (or inflight, depending on pop order) row remains.
        let remaining: i64 = {
            let conn = q.conn.lock().unwrap();
            conn.query_row("SELECT COUNT(*) FROM commands", [], |r| r.get(0))
                .unwrap()
        };
        assert_eq!(remaining, 1);
    }
}

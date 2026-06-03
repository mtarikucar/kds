//! Integration test for the SQLite-backed command queue.
//!
//! We push commands, pop them, and confirm priority + dedup invariants hold
//! across simulated process restarts (opening a fresh handle to the same DB
//! file). These are the invariants the cloud-side queue depends on for
//! "at least once" delivery.

use hummytummy_local_bridge::command_queue::{CommandOutcome, CommandQueue, PendingCommand};
use serde_json::json;
use tempfile::TempDir;

fn make_cmd(id: &str, priority: i32) -> PendingCommand {
    PendingCommand {
        id: id.to_string(),
        kind: "print_receipt".to_string(),
        payload: json!({ "target": "escpos" }),
        priority,
        attempts: 0,
    }
}

#[tokio::test]
async fn push_pop_marks_done() {
    let dir = TempDir::new().unwrap();
    let q = CommandQueue::open(dir.path().join("q.db")).unwrap();
    q.push(&make_cmd("c-1", 0)).await.unwrap();
    let popped = q.pop_next().await.unwrap().expect("queued");
    assert_eq!(popped.id, "c-1");
    q.mark_done(
        &popped.id,
        &CommandOutcome {
            status: "done".into(),
            result: json!({}),
            error: None,
        },
    )
    .await
    .unwrap();
    assert!(
        q.pop_next().await.unwrap().is_none(),
        "queue should be empty"
    );
}

#[tokio::test]
async fn priority_orders_pops() {
    let dir = TempDir::new().unwrap();
    let q = CommandQueue::open(dir.path().join("q.db")).unwrap();
    q.push(&make_cmd("low", 0)).await.unwrap();
    q.push(&make_cmd("high", 10)).await.unwrap();

    let first = q.pop_next().await.unwrap().unwrap();
    assert_eq!(first.id, "high", "priority should win over insertion order");

    let second = q.pop_next().await.unwrap().unwrap();
    assert_eq!(second.id, "low");
}

#[tokio::test]
async fn push_is_idempotent_on_id() {
    let dir = TempDir::new().unwrap();
    let q = CommandQueue::open(dir.path().join("q.db")).unwrap();
    let c = make_cmd("dup-id", 0);
    q.push(&c).await.unwrap();
    q.push(&c).await.unwrap(); // second push silently ignored

    let first = q.pop_next().await.unwrap().expect("first");
    assert_eq!(first.id, "dup-id");
    assert!(q.pop_next().await.unwrap().is_none(), "no duplicate row");
}

#[tokio::test]
async fn mark_failed_requeues_until_cap() {
    let dir = TempDir::new().unwrap();
    let q = CommandQueue::open(dir.path().join("q.db")).unwrap();
    q.push(&make_cmd("flaky", 0)).await.unwrap();

    // First four fails leave status='queued' (attempts <= cap of 5).
    for i in 1..=4 {
        let popped = q.pop_next().await.unwrap().expect("requeued");
        assert_eq!(popped.id, "flaky");
        assert_eq!(popped.attempts, i);
        q.mark_failed(&popped.id, "transient").await.unwrap();
    }

    // Fifth failure should land it in `failed` and stop coming back.
    let popped = q.pop_next().await.unwrap().expect("still queued");
    q.mark_failed(&popped.id, "permanent").await.unwrap();
    assert!(q.pop_next().await.unwrap().is_none(), "should be terminal");
}

#[tokio::test]
async fn state_persists_across_handle_reopens() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("q.db");
    {
        let q = CommandQueue::open(&path).unwrap();
        q.push(&make_cmd("persisted", 5)).await.unwrap();
    }
    {
        // Re-open the same file — represents a process restart.
        let q = CommandQueue::open(&path).unwrap();
        let popped = q.pop_next().await.unwrap().expect("survived restart");
        assert_eq!(popped.id, "persisted");
    }
}

//! GMP-3 protocol layer — vendor-neutral.
//!
//! Two responsibilities in Phase 0:
//!   1. Classify the cloud command kind into a GMP-3 command family.
//!   2. Produce deterministic SIMULATOR outcomes whose JSON shape EXACTLY
//!      matches what the cloud reads back (payment-terminal `mapAck` and
//!      fiscal-core `mapReceiptOutcome`/`runReport`), so the whole rail is
//!      testable end-to-end without certified hardware.
//!
//! The real (certified) path — the DH + PÖKC cert handshake, AES-CBC + HMAC
//! framing, and the İşlem Sıra No (transaction sequence number) that Turkish GİB
//! GMP-3 mandates — is Phase 1. It builds on `transport::TcpEndpoint`; nothing
//! here fabricates a device reply. Until a vendor profile's `real_impl_ready`
//! flips true, `mode = "real"` fails closed via [`real_mode_unavailable`].

use serde_json::{json, Value};

/// A GMP-3 command family, derived from the cloud command `kind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommandFamily {
    /// Coupled card sale — charges the card AND prints the mali fiş in one op.
    ChargeCard,
    /// Void/reverse a previously-approved card charge.
    VoidCard,
    /// Standalone mali fiş (cash / meal-card / non-card sale).
    FiscalReceipt,
    /// Void a previously-issued fiscal receipt.
    FiscalCancel,
    /// GMP-3 X/Z report (day-close for Z).
    FiscalReport,
    /// Read-only device status probe.
    CapabilityProbe,
}

/// Map a cloud command `kind` to its GMP-3 family, or `None` if this driver
/// doesn't handle it (the caller then errors — never a silent no-op).
pub fn classify(kind: &str) -> Option<CommandFamily> {
    match kind {
        "charge_card" => Some(CommandFamily::ChargeCard),
        "void_card" => Some(CommandFamily::VoidCard),
        "fiscal_receipt" => Some(CommandFamily::FiscalReceipt),
        "fiscal_cancel" => Some(CommandFamily::FiscalCancel),
        "fiscal_report" => Some(CommandFamily::FiscalReport),
        "capability_probe" => Some(CommandFamily::CapabilityProbe),
        _ => None,
    }
}

/// The configured simulator outcome for a device (from `gmp3.toml`
/// `sim_outcome`). Defaults to approve.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SimOutcome {
    Approve,
    Decline,
    Error,
}

impl SimOutcome {
    pub fn parse(s: &str) -> SimOutcome {
        match s.trim().to_ascii_lowercase().as_str() {
            "decline" | "declined" => SimOutcome::Decline,
            "error" | "fail" | "failed" => SimOutcome::Error,
            _ => SimOutcome::Approve,
        }
    }
}

/// A simulated command result: either a `done` ack with a result blob, or a
/// `failed` ack with an error string — mapped to a `CommandOutcome` by the
/// driver.
#[derive(Debug, Clone)]
pub enum SimResult {
    Done(Value),
    Failed(String),
}

/// Deterministic reference derived from the command id (no RNG — same command
/// id → same reference, so tests and recovery are reproducible). Clearly
/// `SIM-`/`SIMFIS-` prefixed so a simulated value can NEVER be mistaken for a
/// real bank RRN or fiscal number.
fn short(cmd_id: &str) -> String {
    cmd_id.chars().take(12).collect()
}

/// Build the deterministic simulator outcome for a command family. The JSON keys
/// mirror the real device contract the cloud reads:
///   - card: `{approved, approvalCode, rrn, cardBrand, maskedPan, fiscalNo}`
///   - fiscal receipt: `{fiscalNo, fiscalZNo}`
///   - fiscal report: `{zNo, openedAt, closedAt, totals}`
///   - probe: `{deviceStatus}`
pub fn simulate(family: CommandFamily, cmd_id: &str, outcome: SimOutcome) -> SimResult {
    let s = short(cmd_id);
    match family {
        CommandFamily::ChargeCard => match outcome {
            SimOutcome::Approve => SimResult::Done(json!({
                "approved": true,
                "approvalCode": format!("SIM-{s}"),
                "rrn": format!("SIM-{s}"),
                "cardBrand": "SIMULATOR",
                "maskedPan": "**** **** **** 0000",
                // Coupled: the SP630 prints the fiş atomically with the charge.
                "fiscalNo": format!("SIMFIS-{s}"),
                "simulator": true,
            })),
            SimOutcome::Decline => SimResult::Done(json!({
                "approved": false,
                "error": "Simulated card decline",
                "simulator": true,
            })),
            SimOutcome::Error => SimResult::Failed("Simulated terminal error".into()),
        },
        CommandFamily::VoidCard => match outcome {
            SimOutcome::Approve => SimResult::Done(json!({
                "approved": true,
                "approvalCode": format!("SIM-VOID-{s}"),
                "simulator": true,
            })),
            _ => SimResult::Failed("Simulated void failure".into()),
        },
        CommandFamily::FiscalReceipt => match outcome {
            SimOutcome::Approve => SimResult::Done(json!({
                "fiscalNo": format!("SIMFIS-{s}"),
                "fiscalZNo": "1",
                "simulator": true,
            })),
            _ => SimResult::Failed("Simulated fiscal error".into()),
        },
        CommandFamily::FiscalCancel => match outcome {
            SimOutcome::Approve => SimResult::Done(json!({ "simulator": true })),
            _ => SimResult::Failed("Simulated fiscal cancel failure".into()),
        },
        CommandFamily::FiscalReport => match outcome {
            SimOutcome::Approve => SimResult::Done(json!({
                "zNo": format!("SIMZ-{s}"),
                // Clearly-synthetic epoch timestamps so a simulated Z can never
                // be mistaken for a real day-close.
                "openedAt": "1970-01-01T00:00:00.000Z",
                "closedAt": "1970-01-01T00:00:00.000Z",
                "totals": {},
                "simulator": true,
            })),
            _ => SimResult::Failed("Simulated report failure".into()),
        },
        CommandFamily::CapabilityProbe => match outcome {
            SimOutcome::Error => {
                SimResult::Done(json!({ "deviceStatus": "error", "simulator": true }))
            }
            _ => SimResult::Done(json!({ "deviceStatus": "online", "simulator": true })),
        },
    }
}

/// The honest fail-closed error for a device configured `mode = "real"` on a
/// vendor whose certified GMP-3 handshake is not implemented yet (Phase 0). We
/// do NOT touch the hardware we cannot finish a transaction with.
pub fn real_mode_unavailable(display_name: &str, profile_id: &str) -> String {
    format!(
        "GMP-3 real mode is not certified for {display_name} ({profile_id}) yet — \
         complete Phase-1 vendor onboarding (Token SDK + cert + test device), or set \
         `mode = \"simulator\"` in gmp3.toml for testing. Refusing to move money on an \
         uncertified handshake."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_all_gmp3_kinds() {
        assert_eq!(classify("charge_card"), Some(CommandFamily::ChargeCard));
        assert_eq!(classify("void_card"), Some(CommandFamily::VoidCard));
        assert_eq!(
            classify("fiscal_receipt"),
            Some(CommandFamily::FiscalReceipt)
        );
        assert_eq!(classify("fiscal_cancel"), Some(CommandFamily::FiscalCancel));
        assert_eq!(classify("fiscal_report"), Some(CommandFamily::FiscalReport));
        assert_eq!(
            classify("capability_probe"),
            Some(CommandFamily::CapabilityProbe)
        );
        assert_eq!(classify("print_receipt"), None);
    }

    #[test]
    fn sim_outcome_parses_forgivingly() {
        assert_eq!(SimOutcome::parse("APPROVE"), SimOutcome::Approve);
        assert_eq!(SimOutcome::parse(" decline "), SimOutcome::Decline);
        assert_eq!(SimOutcome::parse("error"), SimOutcome::Error);
        assert_eq!(SimOutcome::parse("weird"), SimOutcome::Approve);
    }

    #[test]
    fn simulated_card_approval_carries_the_full_ack_contract() {
        match simulate(
            CommandFamily::ChargeCard,
            "cmd-abcdef123456",
            SimOutcome::Approve,
        ) {
            SimResult::Done(v) => {
                assert_eq!(v["approved"], true);
                assert_eq!(v["cardBrand"], "SIMULATOR");
                // Coupled fiş present so the finalizer skips the standalone rail.
                assert!(v["fiscalNo"].as_str().unwrap().starts_with("SIMFIS-"));
                assert!(v["approvalCode"].as_str().unwrap().starts_with("SIM-"));
            }
            other => panic!("expected Done, got {other:?}"),
        }
    }

    #[test]
    fn simulated_card_decline_is_done_but_not_approved() {
        match simulate(CommandFamily::ChargeCard, "c1", SimOutcome::Decline) {
            SimResult::Done(v) => {
                assert_eq!(v["approved"], false);
                assert!(v.get("fiscalNo").is_none(), "no fiş on a decline");
            }
            other => panic!("expected Done(declined), got {other:?}"),
        }
    }

    #[test]
    fn simulated_card_error_is_a_failed_ack() {
        match simulate(CommandFamily::ChargeCard, "c1", SimOutcome::Error) {
            SimResult::Failed(_) => {}
            other => panic!("expected Failed, got {other:?}"),
        }
    }

    #[test]
    fn simulated_fiscal_receipt_returns_a_fiscal_no() {
        match simulate(CommandFamily::FiscalReceipt, "cmd-xyz", SimOutcome::Approve) {
            SimResult::Done(v) => {
                assert!(v["fiscalNo"].as_str().unwrap().starts_with("SIMFIS-"))
            }
            other => panic!("expected Done, got {other:?}"),
        }
    }

    #[test]
    fn deterministic_reference_from_command_id() {
        let a = simulate(
            CommandFamily::ChargeCard,
            "same-id-000",
            SimOutcome::Approve,
        );
        let b = simulate(
            CommandFamily::ChargeCard,
            "same-id-000",
            SimOutcome::Approve,
        );
        match (a, b) {
            (SimResult::Done(va), SimResult::Done(vb)) => assert_eq!(va, vb),
            _ => panic!("same command id must yield the same simulated result"),
        }
    }
}

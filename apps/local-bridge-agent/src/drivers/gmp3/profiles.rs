//! GMP-3 vendor profiles.
//!
//! Every certified Turkish *Yeni Nesil ÖKC* speaks the same GİB GMP-3 message
//! family, so the driver is protocol-first, not vendor-first: one `gmp3` driver
//! plus one small profile per brand. A profile carries only the bits that
//! actually differ between vendors: the default TCP port, and whether that
//! brand's real (certified) handshake is implemented yet. Adding a new POS/ÖKC
//! brand later is a single entry here (plus its cert/handshake specifics in
//! `protocol.rs` when the real driver lands) — no new driver, no schema change.

/// One vendor's GMP-3 profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VendorProfile {
    /// The `vendorProfile` string the cloud sends in the command payload
    /// (e.g. "paygo.sp630"). Matched verbatim.
    pub id: &'static str,
    /// Human-readable name, for logs/errors.
    pub display_name: &'static str,
    /// TCP port the device's GMP-3 server listens on when the on-prem
    /// `gmp3.toml` entry omits an explicit `port`.
    pub default_port: u16,
    /// Whether this brand's REAL (certified) GMP-3 handshake is implemented.
    /// While false, a device configured `mode = "real"` fails closed regardless
    /// of config — the honest boundary until Phase-1 vendor onboarding lands.
    pub real_impl_ready: bool,
}

/// All known GMP-3 vendor profiles. Paygo is the first concrete binding; other
/// Turkish ÖKC brands (Beko, Hugin, Profilo, Ingenico, Verifone, Pavo, …) each
/// become one more entry here as they are onboarded.
static PROFILES: &[VendorProfile] = &[VendorProfile {
    id: "paygo.sp630",
    display_name: "Paygo SP630PRO ECR",
    // GMP-3 devices expose their integration server around :59000 on the LAN.
    default_port: 59000,
    // Phase 0: the real cert-handshake driver is not implemented yet. Flip to
    // true only when the certified Paygo/Token GMP-3 handshake ships (Phase 1).
    real_impl_ready: false,
}];

/// Resolve a vendor profile by its `vendorProfile` id, or `None` if unknown.
pub fn resolve(vendor_profile: &str) -> Option<&'static VendorProfile> {
    PROFILES.iter().find(|p| p.id == vendor_profile)
}

/// The ids of every registered profile — surfaced in the "unknown profile"
/// error so an operator sees what IS supported.
pub fn known_ids() -> Vec<&'static str> {
    PROFILES.iter().map(|p| p.id).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_paygo_sp630() {
        let p = resolve("paygo.sp630").expect("paygo profile registered");
        assert_eq!(p.default_port, 59000);
        assert!(
            !p.real_impl_ready,
            "Phase 0 ships the Paygo real handshake as not-ready (fail-closed)"
        );
    }

    #[test]
    fn unknown_profile_resolves_to_none() {
        assert!(resolve("nope.unknown").is_none());
        assert!(known_ids().contains(&"paygo.sp630"));
    }
}

//! ESC/POS receipt-printer driver — REAL byte-writing implementation.
//!
//! Targets the broad family of Epson TM, Star TSP, and compatible printers
//! that speak ESC/POS over network (raw TCP 9100) or a serial/USB device file.
//!
//! ## Division of labour (cloud vs. bridge)
//!
//! The cloud's `EscPosBuilderService` does ALL formatting / i18n / codepage
//! work and ships the finished ESC/POS byte stream down to the bridge as
//! base64 in the command payload. The bridge is a dumb, audited executor: it
//! base64-decodes those bytes and writes them VERBATIM to the configured
//! printer transport. No re-encoding, no re-formatting.
//!
//! ## Command payload shape (produced by the cloud)
//!
//! ```jsonc
//! {
//!   "target": "escpos",        // bridge driver routing key (added by the mesh)
//!   "printerId": "default",    // which local printer (optional; -> "default")
//!   "data": "G0AbdBM...",      // base64 ESC/POS byte stream (REQUIRED)
//!   "codepage": "CP857",       // informational; bridge does NOT re-encode
//!   "artifact": "receipt",     // receipt | kitchen_ticket | drawer_kick
//!   "contentHash": "ab12...",  // sha256 hex of the raw bytes (integrity check)
//!   "pin": 0                   // open_drawer only: ESC p connector pin 0|1
//! }
//! ```
//!
//! `open_drawer` carries its OWN ESC/POS bytes (a bare `ESC p` pulse the cloud
//! builds via `drawerKick`) in the same `data` field, so it is written exactly
//! like a receipt — there is no special drawer escape path on the bridge.
//!
//! ## Transport configuration (resolved LOCALLY on the bridge)
//!
//! The cloud never learns the printer's LAN address (it lives behind NAT), so
//! the transport is configured on-prem in `printers.toml` inside the bridge's
//! data dir:
//!
//! ```toml
//! # Network thermal printer (raw TCP, the JetDirect/9100 de-facto standard).
//! [[printer]]
//! id = "default"
//! transport = "tcp"
//! host = "192.168.1.50"
//! port = 9100            # optional, defaults to 9100
//!
//! # USB/serial thermal printer exposed as a device file.
//! [[printer]]
//! id = "kitchen-01"
//! transport = "device"   # alias: "serial"
//! path = "/dev/usb/lp0"
//! ```
//!
//! ## Honest failure (no fake success)
//!
//! If the transport is not configured, the printer is unreachable, or the
//! write fails, `execute` returns `Err` — which the agent's main loop turns
//! into a `failed` ack to the cloud. The driver NEVER reports `done` unless
//! the bytes were actually handed to the OS and flushed to the printer.

use crate::{
    command_queue::{CommandOutcome, PendingCommand},
    drivers::LocalDriver,
};
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::json;
use std::{
    io::Write,
    net::TcpStream,
    path::{Path, PathBuf},
    time::Duration,
};

/// Default raw-print TCP port (HP JetDirect / "RAW 9100" — the de-facto
/// standard every networked thermal printer listens on).
const DEFAULT_TCP_PORT: u16 = 9100;
/// Connect/write timeout for a network printer. Generous enough for a slow
/// thermal head finishing a long ticket, short enough that a powered-off
/// printer fails fast instead of wedging the dispatch loop.
const TCP_TIMEOUT: Duration = Duration::from_secs(10);

/// One printer's transport, parsed from `printers.toml`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Transport {
    /// Raw TCP (host:port). The portable, driverless path — testable over a
    /// loopback `TcpListener`.
    Tcp { host: String, port: u16 },
    /// A serial/USB printer exposed as an OS device file (e.g. `/dev/usb/lp0`,
    /// `/dev/ttyUSB0`, or a Windows `COM`/`\\.\` path). We open it and write
    /// the raw bytes — most ESC/POS-over-USB printers present a line-printer
    /// device that accepts the byte stream directly.
    Device { path: PathBuf },
}

/// A single `[[printer]]` table from `printers.toml`.
#[derive(Debug, Clone, Deserialize)]
struct PrinterEntry {
    id: String,
    /// "tcp" | "device" | "serial" (serial is an alias for device).
    transport: String,
    // tcp
    host: Option<String>,
    port: Option<u16>,
    // device / serial
    path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct PrintersConfig {
    #[serde(default)]
    printer: Vec<PrinterEntry>,
}

/// A resolved printer the driver can write to.
#[derive(Debug, Clone)]
struct Printer {
    id: String,
    transport: Transport,
}

impl PrinterEntry {
    fn resolve(self) -> Result<Printer> {
        let transport = match self.transport.to_ascii_lowercase().as_str() {
            "tcp" | "network" => {
                let host = self.host.filter(|h| !h.trim().is_empty()).ok_or_else(|| {
                    anyhow!("printer '{}': transport=tcp requires a `host`", self.id)
                })?;
                Transport::Tcp {
                    host,
                    port: self.port.unwrap_or(DEFAULT_TCP_PORT),
                }
            }
            "device" | "serial" | "usb" => {
                let path = self.path.filter(|p| !p.trim().is_empty()).ok_or_else(|| {
                    anyhow!("printer '{}': transport=device requires a `path`", self.id)
                })?;
                Transport::Device {
                    path: PathBuf::from(path),
                }
            }
            other => {
                return Err(anyhow!(
                    "printer '{}': unknown transport '{}' (expected tcp|device|serial)",
                    self.id,
                    other
                ))
            }
        };
        Ok(Printer {
            id: self.id,
            transport,
        })
    }
}

/// The ESC/POS driver. Holds the locally-configured printer transports
/// (loaded once at boot from `printers.toml`); if the file is absent the
/// driver still registers (so the agent boots) but every print honestly fails
/// with a "no printer configured" error rather than faking success.
pub struct EscPosDriver {
    printers: Vec<Printer>,
    /// Where `printers.toml` was looked for — surfaced in error messages so an
    /// operator knows exactly which file to create/fix.
    config_path: PathBuf,
}

impl EscPosDriver {
    /// Production init: read `printers.toml` from the bridge data dir. Always
    /// registers the driver (returns `Some`) so a missing config doesn't drop
    /// the `escpos` kind from the registry — the failure surfaces honestly at
    /// print time (and is visible to the cloud via the failed ack) instead of
    /// the command bouncing as "no driver installed".
    pub async fn try_init(data_dir: &Path) -> Result<Option<Self>> {
        let config_path = data_dir.join("printers.toml");
        let printers = match load_printers(&config_path) {
            Ok(p) => {
                tracing::info!(
                    count = p.len(),
                    path = %config_path.display(),
                    "escpos: loaded printer transports"
                );
                p
            }
            Err(e) => {
                // Not fatal to boot — but loudly logged. Prints will fail
                // honestly until the operator drops a valid printers.toml in.
                tracing::warn!(
                    error = %e,
                    path = %config_path.display(),
                    "escpos: no usable printer config; prints will FAIL until printers.toml is set"
                );
                Vec::new()
            }
        };
        Ok(Some(EscPosDriver {
            printers,
            config_path,
        }))
    }

    /// Test/explicit constructor with a fixed printer set.
    #[cfg(test)]
    fn with_printers(printers: Vec<Printer>) -> Self {
        EscPosDriver {
            printers,
            config_path: PathBuf::from("<test>/printers.toml"),
        }
    }

    fn find(&self, id: &str) -> Option<&Printer> {
        self.printers.iter().find(|p| p.id == id)
    }
}

#[async_trait]
impl LocalDriver for EscPosDriver {
    fn kind(&self) -> &str {
        "escpos"
    }

    async fn execute(&self, cmd: &PendingCommand) -> Result<CommandOutcome> {
        let printer_id = cmd
            .payload
            .get("printerId")
            .and_then(|v| v.as_str())
            .unwrap_or("default");

        // 1. Decode the ESC/POS byte stream the cloud built. A missing/garbled
        //    `data` field is an honest error, NOT a silent no-op print.
        let data_b64 = cmd
            .payload
            .get("data")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                anyhow!(
                    "escpos: command {} has no base64 `data` field — nothing to print",
                    cmd.id
                )
            })?;
        let bytes = base64_decode(data_b64)
            .with_context(|| format!("escpos: decoding base64 `data` for command {}", cmd.id))?;
        if bytes.is_empty() {
            return Err(anyhow!(
                "escpos: command {} decoded to zero bytes — refusing to report a no-op as done",
                cmd.id
            ));
        }

        // 2. Optional integrity check: if the cloud sent a contentHash, verify
        //    the decoded bytes match before writing. A mismatch means a
        //    corrupted/tampered payload — fail rather than print garbage.
        if let Some(expected) = cmd.payload.get("contentHash").and_then(|v| v.as_str()) {
            let actual = sha256_hex(&bytes);
            if !actual.eq_ignore_ascii_case(expected) {
                return Err(anyhow!(
                    "escpos: contentHash mismatch for command {} (expected {}, got {}) — refusing to print",
                    cmd.id,
                    expected,
                    actual
                ));
            }
        }

        // 3. Resolve the transport from the LOCAL printers.toml. No config =>
        //    honest failure, surfaced to the cloud as a failed ack.
        let printer = self.find(printer_id).ok_or_else(|| {
            if self.printers.is_empty() {
                anyhow!(
                    "escpos: no printers configured (looked in {}). Cannot print command {} — create printers.toml",
                    self.config_path.display(),
                    cmd.id
                )
            } else {
                anyhow!(
                    "escpos: no printer with id '{}' in {} (have: {})",
                    printer_id,
                    self.config_path.display(),
                    self.printers
                        .iter()
                        .map(|p| p.id.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            }
        })?;

        // 4. Write the bytes to the real transport. Any connect/write/flush
        //    error propagates as Err — we only fall through to "done" once the
        //    OS has accepted and flushed every byte. The write is blocking I/O
        //    (TcpStream / device file), so it runs on a blocking thread to keep
        //    the (current-thread) async reactor — heartbeat, ack retries —
        //    responsive while a slow thermal head finishes the ticket.
        let transport = printer.transport.clone();
        let byte_len = bytes.len();
        let written = tokio::task::spawn_blocking(move || write_to_transport(&transport, &bytes))
            .await
            .context("escpos: print task panicked")?
            .with_context(|| {
                format!(
                    "escpos: writing {} bytes to printer '{}' ({:?}) for command {}",
                    byte_len, printer.id, printer.transport, cmd.id
                )
            })?;

        tracing::info!(
            printer_id = %printer.id,
            kind = %cmd.kind,
            bytes = written,
            "escpos: receipt written to printer"
        );

        Ok(CommandOutcome {
            status: "done".to_string(),
            result: json!({
                "printer_id": printer.id,
                "bytes_written": written,
            }),
            error: None,
        })
    }
}

/// Write the raw ESC/POS bytes to the configured transport. Returns the number
/// of bytes written on success. Blocking I/O is offloaded so the async
/// dispatch loop is never stalled by a slow/unreachable printer.
fn write_to_transport(transport: &Transport, bytes: &[u8]) -> Result<usize> {
    match transport {
        Transport::Tcp { host, port } => write_tcp(host, *port, bytes),
        Transport::Device { path } => write_device(path, bytes),
    }
}

/// Raw TCP (port 9100) write. Connects with a timeout, writes the whole
/// stream, flushes. A powered-off or wrong-address printer surfaces as a
/// connect error rather than a hang.
fn write_tcp(host: &str, port: u16, bytes: &[u8]) -> Result<usize> {
    use std::net::ToSocketAddrs;

    let addr_str = format!("{host}:{port}");
    // Resolve first so a bad hostname is a clear error, then connect with a
    // bounded timeout to the first resolved address.
    let mut addrs = addr_str
        .to_socket_addrs()
        .with_context(|| format!("resolving printer address {addr_str}"))?;
    let addr = addrs
        .next()
        .ok_or_else(|| anyhow!("printer address {addr_str} resolved to no socket address"))?;

    let mut stream = TcpStream::connect_timeout(&addr, TCP_TIMEOUT)
        .with_context(|| format!("connecting to printer {addr_str}"))?;
    stream
        .set_write_timeout(Some(TCP_TIMEOUT))
        .context("setting printer write timeout")?;
    // Send the bytes promptly rather than waiting for Nagle to coalesce — a
    // receipt is one short burst.
    let _ = stream.set_nodelay(true);

    stream
        .write_all(bytes)
        .with_context(|| format!("writing receipt bytes to {addr_str}"))?;
    stream
        .flush()
        .with_context(|| format!("flushing receipt bytes to {addr_str}"))?;
    Ok(bytes.len())
}

/// Serial/USB device-file write. Opens the device for writing (append so we
/// never truncate a character device) and writes the raw stream.
fn write_device(path: &Path, bytes: &[u8]) -> Result<usize> {
    use std::fs::OpenOptions;

    // `append` implies write-mode; we append (never truncate) so a character
    // device / line-printer node is written to rather than clobbered.
    let mut file = OpenOptions::new()
        .append(true)
        .open(path)
        .with_context(|| format!("opening printer device {}", path.display()))?;
    file.write_all(bytes)
        .with_context(|| format!("writing receipt bytes to {}", path.display()))?;
    file.flush()
        .with_context(|| format!("flushing receipt bytes to {}", path.display()))?;
    Ok(bytes.len())
}

/// Load + resolve `printers.toml`. Errors if the file is missing, unparseable,
/// or yields zero usable printers (so the caller can log it and register the
/// driver in a "will fail honestly" state).
fn load_printers(path: &Path) -> Result<Vec<Printer>> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("reading printer config {}", path.display()))?;
    let cfg: PrintersConfig = toml::from_str(&raw)
        .with_context(|| format!("parsing printer config {}", path.display()))?;
    if cfg.printer.is_empty() {
        return Err(anyhow!(
            "printer config {} has no [[printer]] entries",
            path.display()
        ));
    }
    let mut out = Vec::with_capacity(cfg.printer.len());
    for entry in cfg.printer {
        out.push(entry.resolve()?);
    }
    Ok(out)
}

// ───────────────────────────── base64 (std-only) ─────────────────────────────
//
// The cloud sends the ESC/POS stream base64-encoded. We decode it with a tiny,
// dependency-free standard-alphabet decoder (RFC 4648, `+/`, optional `=`
// padding) so the bridge pulls in no extra crate just to read a receipt.

/// Decode a standard-alphabet base64 string into raw bytes. Tolerates trailing
/// `=` padding and rejects any other invalid character (so a corrupted payload
/// fails loudly instead of producing garbage bytes the printer would spew).
fn base64_decode(input: &str) -> Result<Vec<u8>> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let mut out = Vec::with_capacity(input.len() / 4 * 3 + 3);
    let mut quad = [0u8; 4];
    let mut n = 0usize; // sextets accumulated in the current group (0..=4)
    let mut pad = 0usize; // '=' padding chars seen in the current group

    for &c in input.as_bytes() {
        // Skip ASCII whitespace (newlines etc.) defensively.
        if c == b'\r' || c == b'\n' || c == b' ' || c == b'\t' {
            continue;
        }
        if c == b'=' {
            // Padding only ever appears at the very end of a group, after at
            // least 2 data chars (a lone leading '=' is invalid).
            if n < 2 {
                return Err(anyhow!("base64: stray '=' padding"));
            }
            quad[n] = 0;
            n += 1;
            pad += 1;
        } else {
            if pad > 0 {
                return Err(anyhow!("base64: data character after '=' padding"));
            }
            let v = val(c).ok_or_else(|| anyhow!("base64: invalid character {:?}", c as char))?;
            quad[n] = v;
            n += 1;
        }
        if n == 4 {
            emit(&quad, pad, &mut out)?;
            n = 0;
            pad = 0;
        }
    }

    // Handle an unpadded tail (the cloud always pads, but be liberal on input).
    if n > 0 {
        if n == 1 {
            return Err(anyhow!("base64: invalid length (dangling 6 bits)"));
        }
        for slot in quad.iter_mut().skip(n) {
            *slot = 0;
        }
        emit(&quad, 4 - n, &mut out)?;
    }
    Ok(out)
}

/// Emit the decoded bytes of one 4-sextet group, dropping `pad` trailing bytes
/// (0 → 3 bytes, 1 → 2 bytes, 2 → 1 byte).
fn emit(quad: &[u8; 4], pad: usize, out: &mut Vec<u8>) -> Result<()> {
    let n =
        (quad[0] as u32) << 18 | (quad[1] as u32) << 12 | (quad[2] as u32) << 6 | (quad[3] as u32);
    let b0 = (n >> 16) as u8;
    let b1 = (n >> 8) as u8;
    let b2 = n as u8;
    match pad {
        0 => {
            out.push(b0);
            out.push(b1);
            out.push(b2);
        }
        1 => {
            out.push(b0);
            out.push(b1);
        }
        2 => {
            out.push(b0);
        }
        _ => return Err(anyhow!("base64: too much padding")),
    }
    Ok(())
}

// ───────────────────────────── sha256 (via sha2 crate) ───────────────────────

/// Hex sha256 of a byte slice, for the optional `contentHash` integrity check.
/// `sha2` is already a workspace dependency (used elsewhere in the agent).
fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    let mut s = String::with_capacity(digest.len() * 2);
    for b in digest {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::io::Read;
    use std::net::TcpListener;
    use std::sync::mpsc;

    fn print_cmd(id: &str, printer_id: Option<&str>, data_b64: &str) -> PendingCommand {
        let mut payload = json!({ "target": "escpos", "data": data_b64 });
        if let Some(pid) = printer_id {
            payload["printerId"] = json!(pid);
        }
        PendingCommand {
            id: id.to_string(),
            kind: "print_receipt".to_string(),
            payload,
            priority: 0,
            attempts: 0,
        }
    }

    fn b64(bytes: &[u8]) -> String {
        // Encode with the standard alphabet so tests don't depend on an
        // external crate either — mirror our decoder's alphabet.
        const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | (b[2] as u32);
            out.push(A[((n >> 18) & 63) as usize] as char);
            out.push(A[((n >> 12) & 63) as usize] as char);
            if chunk.len() > 1 {
                out.push(A[((n >> 6) & 63) as usize] as char);
            } else {
                out.push('=');
            }
            if chunk.len() > 2 {
                out.push(A[(n & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
        out
    }

    // ── base64 decode correctness ─────────────────────────────────────────

    #[test]
    fn base64_roundtrips_known_vectors() {
        // RFC 4648 test vectors.
        assert_eq!(base64_decode("").unwrap(), b"");
        assert_eq!(base64_decode("Zg==").unwrap(), b"f");
        assert_eq!(base64_decode("Zm8=").unwrap(), b"fo");
        assert_eq!(base64_decode("Zm9v").unwrap(), b"foo");
        assert_eq!(base64_decode("Zm9vYg==").unwrap(), b"foob");
        assert_eq!(base64_decode("Zm9vYmE=").unwrap(), b"fooba");
        assert_eq!(base64_decode("Zm9vYmFy").unwrap(), b"foobar");
    }

    #[test]
    fn base64_decodes_binary_escpos_bytes() {
        // A realistic ESC/POS preamble: ESC @  ESC t 19 ... contains 0x00/0x1b.
        let raw = vec![0x1b, 0x40, 0x1b, 0x74, 0x13, 0x00, 0xff, 0x80, 0x0a];
        let encoded = b64(&raw);
        assert_eq!(base64_decode(&encoded).unwrap(), raw);
    }

    #[test]
    fn base64_rejects_invalid_characters() {
        assert!(base64_decode("Zm9v!!!!").is_err());
        assert!(base64_decode("@@@@").is_err());
    }

    #[test]
    fn base64_tolerates_embedded_whitespace() {
        assert_eq!(base64_decode("Zm9v\nYmFy").unwrap(), b"foobar");
    }

    // ── transport not configured → honest Err (never "done") ──────────────

    #[tokio::test]
    async fn no_printer_configured_fails_honestly_not_done() {
        let driver = EscPosDriver::with_printers(vec![]);
        let cmd = print_cmd("c-1", None, &b64(b"\x1b@hello"));
        let res = driver.execute(&cmd).await;
        assert!(
            res.is_err(),
            "with no printers.toml the print MUST fail, not report done"
        );
        let msg = res.unwrap_err().to_string();
        assert!(
            msg.contains("no printers configured"),
            "error should name the missing config, got: {msg}"
        );
    }

    #[tokio::test]
    async fn unknown_printer_id_fails_honestly() {
        let driver = EscPosDriver::with_printers(vec![Printer {
            id: "default".to_string(),
            transport: Transport::Tcp {
                host: "127.0.0.1".to_string(),
                port: 9100,
            },
        }]);
        let cmd = print_cmd("c-2", Some("kitchen-99"), &b64(b"\x1b@x"));
        let err = driver.execute(&cmd).await.unwrap_err().to_string();
        assert!(err.contains("kitchen-99"), "names the missing printer id");
    }

    #[tokio::test]
    async fn missing_data_field_fails_honestly() {
        let driver = EscPosDriver::with_printers(vec![Printer {
            id: "default".to_string(),
            transport: Transport::Tcp {
                host: "127.0.0.1".to_string(),
                port: 9100,
            },
        }]);
        let cmd = PendingCommand {
            id: "c-3".to_string(),
            kind: "print_receipt".to_string(),
            payload: json!({ "target": "escpos" }), // no data
            priority: 0,
            attempts: 0,
        };
        let err = driver.execute(&cmd).await.unwrap_err().to_string();
        assert!(err.contains("no base64 `data`"), "got: {err}");
    }

    #[tokio::test]
    async fn empty_decoded_payload_is_not_reported_done() {
        let driver = EscPosDriver::with_printers(vec![Printer {
            id: "default".to_string(),
            transport: Transport::Tcp {
                host: "127.0.0.1".to_string(),
                port: 9100,
            },
        }]);
        let cmd = print_cmd("c-4", None, ""); // decodes to zero bytes
        let err = driver.execute(&cmd).await.unwrap_err().to_string();
        assert!(err.contains("zero bytes"), "got: {err}");
    }

    #[tokio::test]
    async fn content_hash_mismatch_refuses_to_print() {
        let driver = EscPosDriver::with_printers(vec![Printer {
            id: "default".to_string(),
            transport: Transport::Tcp {
                host: "127.0.0.1".to_string(),
                port: 9100,
            },
        }]);
        let mut cmd = print_cmd("c-5", None, &b64(b"\x1b@receipt"));
        cmd.payload["contentHash"] = json!("deadbeef"); // wrong
        let err = driver.execute(&cmd).await.unwrap_err().to_string();
        assert!(err.contains("contentHash mismatch"), "got: {err}");
    }

    #[tokio::test]
    async fn unreachable_tcp_printer_fails_not_done() {
        // Port 1 on loopback: nothing listens → connect error → Err.
        let driver = EscPosDriver::with_printers(vec![Printer {
            id: "default".to_string(),
            transport: Transport::Tcp {
                host: "127.0.0.1".to_string(),
                port: 1,
            },
        }]);
        let cmd = print_cmd("c-6", None, &b64(b"\x1b@x"));
        assert!(
            driver.execute(&cmd).await.is_err(),
            "unreachable printer must fail, not report done"
        );
    }

    // ── REAL write path: loopback TCP asserts exact bytes ─────────────────

    #[tokio::test]
    async fn writes_exact_bytes_to_tcp_printer() {
        // Stand up a loopback listener acting as the printer's raw-9100 port.
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = mpsc::channel::<Vec<u8>>();

        // The "printer" reads everything the bridge writes and reports it back.
        let server = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().expect("printer accepts connection");
            let mut buf = Vec::new();
            sock.read_to_end(&mut buf).expect("printer reads stream");
            tx.send(buf).unwrap();
        });

        // A representative ESC/POS receipt: init + codepage + text + cut, with
        // binary control bytes (0x1b, 0x1d, 0x00) that base64 must preserve.
        let receipt: Vec<u8> = vec![
            0x1b, 0x40, // ESC @  (init)
            0x1b, 0x74, 0x13, // ESC t 19 (CP857)
            b'M', b'e', b'r', b'h', b'a', b'b', b'a', 0x0a, // "Merhaba\n"
            0x1d, 0x56, 0x42, 0x00, // GS V 66 0 (cut)
        ];

        let driver = EscPosDriver::with_printers(vec![Printer {
            id: "default".to_string(),
            transport: Transport::Tcp {
                host: addr.ip().to_string(),
                port: addr.port(),
            },
        }]);

        let cmd = print_cmd("c-print", None, &b64(&receipt));
        let outcome = driver.execute(&cmd).await.expect("print succeeds");

        assert_eq!(outcome.status, "done");
        assert_eq!(outcome.error, None);
        assert_eq!(outcome.result["bytes_written"], json!(receipt.len()));

        let received = rx
            .recv_timeout(Duration::from_secs(5))
            .expect("printer got bytes");
        server.join().unwrap();
        assert_eq!(
            received, receipt,
            "the EXACT ESC/POS byte stream must reach the printer, byte-for-byte"
        );
    }

    #[tokio::test]
    async fn open_drawer_bytes_are_written_like_a_receipt() {
        // open_drawer carries its own ESC p pulse in `data`; it's written the
        // same way. Assert the drawer-kick bytes land on the wire verbatim.
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        let server = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = Vec::new();
            sock.read_to_end(&mut buf).unwrap();
            tx.send(buf).unwrap();
        });

        // ESC p 0 25 250  — standard cash-drawer kick pulse.
        let drawer: Vec<u8> = vec![0x1b, 0x70, 0x00, 25, 250];
        let driver = EscPosDriver::with_printers(vec![Printer {
            id: "default".to_string(),
            transport: Transport::Tcp {
                host: addr.ip().to_string(),
                port: addr.port(),
            },
        }]);
        let mut cmd = print_cmd("c-drawer", None, &b64(&drawer));
        cmd.kind = "open_drawer".to_string();
        cmd.payload["artifact"] = json!("drawer_kick");
        cmd.payload["pin"] = json!(0);

        let outcome = driver.execute(&cmd).await.expect("drawer kick succeeds");
        assert_eq!(outcome.status, "done");

        let received = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        server.join().unwrap();
        assert_eq!(received, drawer, "drawer-kick bytes must reach the printer");
    }

    #[tokio::test]
    async fn correct_content_hash_allows_print() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            let mut buf = Vec::new();
            let _ = sock.read_to_end(&mut buf);
        });

        let receipt = b"\x1b@hash-checked".to_vec();
        let hash = sha256_hex(&receipt);
        let driver = EscPosDriver::with_printers(vec![Printer {
            id: "default".to_string(),
            transport: Transport::Tcp {
                host: addr.ip().to_string(),
                port: addr.port(),
            },
        }]);
        let mut cmd = print_cmd("c-hash-ok", None, &b64(&receipt));
        cmd.payload["contentHash"] = json!(hash);
        let outcome = driver.execute(&cmd).await.expect("matching hash prints");
        assert_eq!(outcome.status, "done");
        server.join().unwrap();
    }

    // ── REAL write path: device-file (serial/USB) write ───────────────────

    #[tokio::test]
    async fn writes_exact_bytes_to_device_file() {
        // A regular temp file stands in for the OS line-printer device node; we
        // exercise the same OpenOptions(write+append)/write_all/flush path.
        let dir = tempfile::TempDir::new().unwrap();
        let dev = dir.path().join("lp0");
        // Pre-create the "device" so append-open succeeds.
        std::fs::write(&dev, b"").unwrap();

        let driver = EscPosDriver::with_printers(vec![Printer {
            id: "default".to_string(),
            transport: Transport::Device { path: dev.clone() },
        }]);
        let receipt: Vec<u8> = vec![0x1b, 0x40, b'O', b'K', 0x0a, 0x1d, 0x56, 0x42, 0x00];
        let cmd = print_cmd("c-dev", None, &b64(&receipt));
        let outcome = driver.execute(&cmd).await.expect("device write succeeds");
        assert_eq!(outcome.status, "done");
        assert_eq!(outcome.result["bytes_written"], json!(receipt.len()));

        let written = std::fs::read(&dev).unwrap();
        assert_eq!(written, receipt, "device file must hold the exact bytes");
    }

    #[tokio::test]
    async fn device_open_failure_fails_honestly() {
        // A path that cannot be opened for writing → Err, never "done".
        let driver = EscPosDriver::with_printers(vec![Printer {
            id: "default".to_string(),
            transport: Transport::Device {
                path: PathBuf::from("/nonexistent-dir-xyz/printer/lp0"),
            },
        }]);
        let cmd = print_cmd("c-dev-fail", None, &b64(b"\x1b@x"));
        assert!(
            driver.execute(&cmd).await.is_err(),
            "unopenable device must fail, not report done"
        );
    }

    // ── printers.toml parsing ─────────────────────────────────────────────

    #[test]
    fn loads_tcp_and_device_printers_from_toml() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("printers.toml");
        std::fs::write(
            &path,
            r#"
                [[printer]]
                id = "default"
                transport = "tcp"
                host = "192.168.1.50"

                [[printer]]
                id = "kitchen-01"
                transport = "serial"
                path = "/dev/usb/lp0"
            "#,
        )
        .unwrap();

        let printers = load_printers(&path).unwrap();
        assert_eq!(printers.len(), 2);
        assert_eq!(
            printers[0].transport,
            Transport::Tcp {
                host: "192.168.1.50".to_string(),
                port: 9100, // default applied
            }
        );
        assert_eq!(
            printers[1].transport,
            Transport::Device {
                path: PathBuf::from("/dev/usb/lp0"),
            }
        );
    }

    #[test]
    fn missing_config_file_is_an_error() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("does-not-exist.toml");
        assert!(load_printers(&path).is_err());
    }

    #[test]
    fn tcp_printer_without_host_is_rejected() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().join("printers.toml");
        std::fs::write(
            &path,
            r#"
                [[printer]]
                id = "default"
                transport = "tcp"
            "#,
        )
        .unwrap();
        let err = load_printers(&path).unwrap_err().to_string();
        assert!(err.contains("requires a `host`"), "got: {err}");
    }

    #[test]
    fn sha256_hex_matches_known_vector() {
        // sha256("") well-known digest.
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }
}

//! Bidirectional TCP transport for GMP-3 devices.
//!
//! Unlike the ESC/POS printer path (`escpos::write_tcp`, which is write-only),
//! a GMP-3 ÖKC is a request/response peer: we send a sale/receipt frame and
//! read back a sequence-numbered result. This module provides that missing read
//! half as a small, dependency-free, real primitive — the on-prem bridge is the
//! TCP CLIENT and the device (Paygo SP630) is the server on the LAN.
//!
//! Phase 0 exposes a half-close request/response exchange (`request_reply`):
//! connect → write the whole request → `shutdown(Write)` to signal end-of-request
//! → read the reply to EOF. It is real and unit-tested against a loopback server.
//! The certified GMP-3 wire framing (length-prefixed / STX-ETX over a persistent,
//! encrypted socket with the İşlem Sıra No handshake) lands in Phase 1 and builds
//! on this primitive; nothing here fakes a device.

use anyhow::{anyhow, Context, Result};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::time::Duration;

/// A GMP-3 device endpoint on the LAN.
#[derive(Debug, Clone)]
pub struct TcpEndpoint {
    pub host: String,
    pub port: u16,
    /// Bounded connect timeout so a powered-off device fails fast instead of
    /// wedging the dispatch loop.
    pub connect_timeout: Duration,
    /// Read/write timeout for the exchange itself.
    pub io_timeout: Duration,
}

impl TcpEndpoint {
    /// Endpoint with conservative default timeouts (10s connect, 20s I/O — a
    /// card sale involves a cardholder tapping/inserting + an acquirer round
    /// trip, so the I/O timeout is generous).
    pub fn new(host: impl Into<String>, port: u16) -> Self {
        Self {
            host: host.into(),
            port,
            connect_timeout: Duration::from_secs(10),
            io_timeout: Duration::from_secs(20),
        }
    }

    /// Half-close request/response. Connects (bounded), writes the whole
    /// request, half-closes the write side to signal "request complete", then
    /// reads the device's reply to EOF. Any connect/write/read error surfaces as
    /// `Err` — the caller turns that into a `failed` ack; we NEVER synthesise a
    /// reply.
    pub fn request_reply(&self, request: &[u8]) -> Result<Vec<u8>> {
        let addr_str = format!("{}:{}", self.host, self.port);
        let addr = addr_str
            .to_socket_addrs()
            .with_context(|| format!("resolving GMP-3 device address {addr_str}"))?
            .next()
            .ok_or_else(|| {
                anyhow!("GMP-3 device address {addr_str} resolved to no socket address")
            })?;

        let mut stream = TcpStream::connect_timeout(&addr, self.connect_timeout)
            .with_context(|| format!("connecting to GMP-3 device {addr_str}"))?;
        stream
            .set_read_timeout(Some(self.io_timeout))
            .context("setting GMP-3 read timeout")?;
        stream
            .set_write_timeout(Some(self.io_timeout))
            .context("setting GMP-3 write timeout")?;
        // A GMP-3 frame is one short burst; send promptly rather than waiting
        // for Nagle to coalesce.
        let _ = stream.set_nodelay(true);

        stream
            .write_all(request)
            .with_context(|| format!("writing GMP-3 request to {addr_str}"))?;
        stream.flush().ok();
        // Signal end-of-request so the device can reply and we can read to EOF.
        stream
            .shutdown(Shutdown::Write)
            .with_context(|| format!("half-closing write to {addr_str}"))?;

        let mut reply = Vec::new();
        stream
            .read_to_end(&mut reply)
            .with_context(|| format!("reading GMP-3 reply from {addr_str}"))?;
        Ok(reply)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::mpsc;

    #[test]
    fn request_reply_round_trips_over_loopback() {
        // Stand up a loopback "device": read the request, echo a canned reply.
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback");
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = mpsc::channel::<Vec<u8>>();

        let server = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().expect("device accepts connection");
            let mut got = Vec::new();
            sock.read_to_end(&mut got)
                .expect("device reads request to EOF");
            tx.send(got).unwrap();
            sock.write_all(b"GMP3-OK:fiscalNo=42")
                .expect("device writes reply");
        });

        let ep = TcpEndpoint::new(addr.ip().to_string(), addr.port());
        let reply = ep
            .request_reply(b"SALE:amount=12345")
            .expect("request/response succeeds");

        assert_eq!(reply, b"GMP3-OK:fiscalNo=42");
        let received = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        server.join().unwrap();
        assert_eq!(
            received, b"SALE:amount=12345",
            "the device must receive the exact request bytes"
        );
    }

    #[test]
    fn unreachable_device_fails_not_hangs() {
        // Port 1 on loopback: nothing listens → connect error → Err (never a
        // fabricated reply).
        let ep = TcpEndpoint {
            host: "127.0.0.1".to_string(),
            port: 1,
            connect_timeout: Duration::from_millis(500),
            io_timeout: Duration::from_millis(500),
        };
        assert!(ep.request_reply(b"x").is_err());
    }
}

//! ESC/POS thermal-printer command construction.
//!
//! Owns:
//! - `PrinterCommand` enum + `to_bytes()` — the ESC/POS instruction set we use
//! - `codepage` submodule — UTF-8 → CP-857 transcoder for Turkish receipts
//!
//! `PrinterCommand::Initialize` emits the standard reset (`ESC @`) followed
//! by `ESC t 13` to switch the printer into CP-857 mode so subsequent
//! `Text` / `TextLine` byte streams (which are CP-857-encoded by the
//! transcoder) print Turkish characters correctly.

pub mod codepage;

use codepage::{utf8_to_cp857, CP857_SELECTOR};

/// Bluetooth/serial/network thermal-printer commands (ESC/POS standard).
#[derive(Debug, Clone)]
pub enum PrinterCommand {
    /// Reset the printer and select the CP-857 (Turkish) code page.
    Initialize,
    /// Print text without trailing newline.
    Text(String),
    /// Print text with a trailing newline (LF).
    TextLine(String),
    /// Feed paper N lines.
    Feed(u8),
    /// Full paper cut.
    Cut,
    /// Text alignment: 0=left, 1=center, 2=right.
    Align(u8),
    /// Text size: width and height multipliers (1..=8 each).
    TextSize(u8, u8),
    /// Toggle bold rendering.
    Bold(bool),
    /// CODE39 barcode.
    Barcode(String),
    /// QR code (Model 2, error correction L).
    QRCode(String),
}

impl PrinterCommand {
    /// Convert this command into the ESC/POS byte sequence the printer expects.
    /// Text-bearing variants transcode UTF-8 → CP-857 so Turkish characters
    /// (ç ğ ı ö ş ü plus uppercase variants) print correctly on receipts.
    pub fn to_bytes(&self) -> Vec<u8> {
        match self {
            PrinterCommand::Initialize => {
                // ESC @ (reset) + ESC t 13 (select CP-857 / Turkish).
                // Sending the code-page selector once on Initialize means
                // every subsequent Text/TextLine on this connection prints
                // with the correct Turkish glyph table.
                vec![0x1B, 0x40, 0x1B, 0x74, CP857_SELECTOR]
            }
            PrinterCommand::Text(text) => utf8_to_cp857(text),
            PrinterCommand::TextLine(text) => {
                let mut bytes = utf8_to_cp857(text);
                bytes.push(0x0A); // LF
                bytes
            }
            PrinterCommand::Feed(lines) => vec![0x1B, 0x64, *lines], // ESC d n
            PrinterCommand::Cut => vec![0x1D, 0x56, 0x00], // GS V 0
            PrinterCommand::Align(alignment) => vec![0x1B, 0x61, *alignment], // ESC a n
            PrinterCommand::TextSize(width, height) => {
                let size = ((width - 1) << 4) | (height - 1);
                vec![0x1D, 0x21, size] // GS ! n
            }
            PrinterCommand::Bold(enabled) => {
                vec![0x1B, 0x45, if *enabled { 1 } else { 0 }] // ESC E n
            }
            PrinterCommand::Barcode(data) => {
                // CODE39 barcodes are 1D ASCII — no CP-857 transcode needed
                // (and would corrupt the symbol set if applied).
                let mut bytes = vec![
                    0x1D, 0x68, 0x64, // GS h 100 (height)
                    0x1D, 0x77, 0x02, // GS w 2 (width)
                    0x1D, 0x6B, 0x04, // GS k 4 (CODE39)
                ];
                bytes.extend_from_slice(data.as_bytes());
                bytes.push(0x00); // NULL terminator
                bytes
            }
            PrinterCommand::QRCode(data) => {
                // QR code data is opaque bytes to the printer; no CP-857
                // transcode (the QR encoder handles Unicode itself if used).
                let mut bytes = vec![
                    0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00, // Model
                    0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x08, // Size
                    0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x30, // Error correction
                ];
                let len = data.len() + 3;
                bytes.extend_from_slice(&[
                    0x1D, 0x28, 0x6B,
                    (len & 0xFF) as u8,
                    ((len >> 8) & 0xFF) as u8,
                    0x31, 0x50, 0x30,
                ]);
                bytes.extend_from_slice(data.as_bytes());
                bytes.extend_from_slice(&[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);
                bytes
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_sends_reset_and_cp857_selector() {
        // ESC @ resets the printer; ESC t 13 selects CP-857 (Turkish).
        // Verifies Bug E's wire-level fix lands on every print job.
        assert_eq!(
            PrinterCommand::Initialize.to_bytes(),
            vec![0x1B, 0x40, 0x1B, 0x74, 13]
        );
    }

    #[test]
    fn text_line_transcodes_turkish_chars_to_cp857() {
        // "Şiş" — three Turkish letters plus newline.
        // Ş=0x9E, i=ASCII, ş=0x9F, then LF=0x0A.
        let bytes = PrinterCommand::TextLine("Şiş".to_string()).to_bytes();
        assert_eq!(bytes, vec![0x9E, b'i', 0x9F, 0x0A]);
    }

    #[test]
    fn text_without_newline_omits_lf() {
        let bytes = PrinterCommand::Text("ok".to_string()).to_bytes();
        assert_eq!(bytes, b"ok".to_vec());
    }

    #[test]
    fn feed_cut_align_unaffected_by_cp857() {
        assert_eq!(PrinterCommand::Feed(3).to_bytes(), vec![0x1B, 0x64, 3]);
        assert_eq!(PrinterCommand::Cut.to_bytes(), vec![0x1D, 0x56, 0x00]);
        assert_eq!(PrinterCommand::Align(1).to_bytes(), vec![0x1B, 0x61, 1]);
    }

    #[test]
    fn barcode_keeps_ascii_payload_unchanged() {
        // CODE39 must stay ASCII — confirm we didn't accidentally run the
        // payload through utf8_to_cp857.
        let bytes = PrinterCommand::Barcode("ABC123".to_string()).to_bytes();
        // Last 7 bytes = "ABC123" + NULL terminator
        assert_eq!(&bytes[bytes.len() - 7..], &[b'A', b'B', b'C', b'1', b'2', b'3', 0x00]);
    }
}


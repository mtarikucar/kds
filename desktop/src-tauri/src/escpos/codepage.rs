//! UTF-8 → CP-857 transcoder for Turkish ESC/POS receipt printing.
//!
//! CP-857 covers Latin-5 / Turkish. Most generic thermal printers default to
//! CP-437 (US ASCII) or CP-850 (Multilingual Latin-1), neither of which has
//! the dotted/dotless I or the cedilla'd letters Turkish menus use. We send
//! `ESC t 13` once on Initialize to switch the printer to CP-857, then map
//! each non-ASCII char in TextLine commands through this table before send.
//!
//! Source: Microsoft codepage 857 reference + ESC/POS docs (Star Micronics,
//! Epson). Covers the full Turkish alphabet (Ç ç Ğ ğ I ı İ Ö ö Ş ş Ü ü)
//! plus the small set of Latin-1 letters Turkish menus borrow.
//!
//! Unmapped characters become `?` (0x3F) — better than silent truncation
//! or panicking in the print pipeline.

/// CP-857 selector byte (the `n` argument to `ESC t n`).
///
/// ESC/POS code-page table puts CP-857 at index 13 on Epson-family printers
/// and most generic Chinese clones (Xprinter, Goojprt, Munbyn, etc.).
/// If a particular printer model needs a different selector, switch this
/// constant once it's calibrated by Phase 1.3 hardware testing.
pub const CP857_SELECTOR: u8 = 13;

/// Transcode a UTF-8 string to CP-857 bytes. Each input char that has no
/// CP-857 mapping is replaced by '?' (0x3F).
pub fn utf8_to_cp857(input: &str) -> Vec<u8> {
    input.chars().map(map_char).collect()
}

fn map_char(c: char) -> u8 {
    // ASCII range pass-through (0x00..0x7F is identical in CP-857).
    if (c as u32) < 0x80 {
        return c as u8;
    }
    match c {
        // Latin-1 supplement (CP-857 columns 0x80..0x9F)
        'Ç' => 0x80,
        'ü' => 0x81,
        'é' => 0x82,
        'â' => 0x83,
        'ä' => 0x84,
        'à' => 0x85,
        'å' => 0x86,
        'ç' => 0x87,
        'ê' => 0x88,
        'ë' => 0x89,
        'è' => 0x8A,
        'ï' => 0x8B,
        'î' => 0x8C,
        'ı' => 0x8D, // dotless lowercase i — Turkish-specific
        'Ä' => 0x8E,
        'Å' => 0x8F,
        'É' => 0x90,
        'æ' => 0x91,
        'Æ' => 0x92,
        'ô' => 0x93,
        'ö' => 0x94,
        'ò' => 0x95,
        'û' => 0x96,
        'ù' => 0x97,
        'İ' => 0x98, // dotted uppercase I — Turkish-specific
        'Ö' => 0x99,
        'Ü' => 0x9A,
        'ø' => 0x9B,
        '£' => 0x9C,
        'Ø' => 0x9D,
        'Ş' => 0x9E,
        'ş' => 0x9F,
        // Latin-1 supplement (CP-857 columns 0xA0..0xAF)
        'á' => 0xA0,
        'í' => 0xA1,
        'ó' => 0xA2,
        'ú' => 0xA3,
        'ñ' => 0xA4,
        'Ñ' => 0xA5,
        'Ğ' => 0xA6, // Turkish-specific
        'ğ' => 0xA7, // Turkish-specific
        '¿' => 0xA8,
        '®' => 0xA9,
        '¬' => 0xAA,
        '½' => 0xAB,
        '¼' => 0xAC,
        '¡' => 0xAD,
        '«' => 0xAE,
        '»' => 0xAF,
        // Box-drawing range 0xB0..0xDF intentionally unmapped — receipts
        // don't use them, and a thermal printer set to CP-857 will print
        // them as graphics if the byte happens to slip through.

        // Currency: € is at 0xD5 in the Microsoft variant of CP-857.
        '€' => 0xD5,

        // Anything else: emit '?' so the print pipeline never panics on
        // unexpected unicode. Prefer visible failure to silent truncation.
        _ => b'?',
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_passthrough() {
        assert_eq!(utf8_to_cp857("Hello, World!"), b"Hello, World!".to_vec());
        assert_eq!(utf8_to_cp857(""), Vec::<u8>::new());
        assert_eq!(utf8_to_cp857("0123456789"), b"0123456789".to_vec());
    }

    #[test]
    fn turkish_alphabet_lowercase() {
        // ç ğ ı ö ş ü
        assert_eq!(
            utf8_to_cp857("çğıöşü"),
            vec![0x87, 0xA7, 0x8D, 0x94, 0x9F, 0x81]
        );
    }

    #[test]
    fn turkish_alphabet_uppercase() {
        // Ç Ğ İ Ö Ş Ü
        assert_eq!(
            utf8_to_cp857("ÇĞİÖŞÜ"),
            vec![0x80, 0xA6, 0x98, 0x99, 0x9E, 0x9A]
        );
    }

    #[test]
    fn dotted_vs_dotless_i_distinction() {
        // The whole reason CP-857 exists vs CP-850: Turkish I has 4 forms.
        // Plain I/i (ASCII), İ (dotted upper, Turkish), ı (dotless lower).
        // The 'I' in "İstanbul" must NOT collapse to ASCII 'I'.
        let bytes = utf8_to_cp857("İstanbul");
        assert_eq!(bytes[0], 0x98); // İ
        assert_eq!(bytes[1], b's');
        assert_eq!(bytes[2], b't');
        assert_eq!(bytes[3], b'a');
        assert_eq!(bytes[4], b'n');
        assert_eq!(bytes[5], b'b');
        assert_eq!(bytes[6], b'u');
        assert_eq!(bytes[7], b'l');
    }

    #[test]
    fn turkish_menu_item_realistic() {
        // A real receipt line: "Adana Kebap" (no Turkish chars in this name)
        assert_eq!(utf8_to_cp857("Adana Kebap"), b"Adana Kebap".to_vec());
        // "Künefe" — has ü
        assert_eq!(utf8_to_cp857("Künefe"), vec![b'K', 0x81, b'n', b'e', b'f', b'e']);
        // "Şiş" — has Ş and ş
        assert_eq!(utf8_to_cp857("Şiş"), vec![0x9E, b'i', 0x9F]);
    }

    #[test]
    fn unknown_chars_become_question_mark() {
        // Emoji is not in CP-857.
        assert_eq!(utf8_to_cp857("🍔"), vec![b'?']);
        // CJK is not in CP-857.
        assert_eq!(utf8_to_cp857("中文"), vec![b'?', b'?']);
        // Cyrillic is not in CP-857.
        assert_eq!(utf8_to_cp857("привет"), vec![b'?'; 6]);
    }

    #[test]
    fn euro_sign_maps_to_d5() {
        assert_eq!(utf8_to_cp857("€"), vec![0xD5]);
        // In a price line: "12,50 €"
        let bytes = utf8_to_cp857("12,50 €");
        assert_eq!(bytes, vec![b'1', b'2', b',', b'5', b'0', b' ', 0xD5]);
    }

    #[test]
    fn cp857_selector_constant() {
        // Sanity-check the constant. The `ESC t n` sequence the printer
        // sees is [0x1B, 0x74, CP857_SELECTOR]. If a future printer model
        // needs a different code page, this constant is the single point
        // of truth.
        assert_eq!(CP857_SELECTOR, 13);
    }

    #[test]
    fn round_trip_full_turkish_alphabet() {
        // Full lower + upper Turkish alphabet in one string.
        let input = "abcçdefgğhıijklmnoöprsştuüvyzABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ";
        let bytes = utf8_to_cp857(input);
        // Every byte must be a single byte (CP-857 is single-byte).
        // Verify the count matches char count.
        assert_eq!(bytes.len(), input.chars().count());
        // No '?' fallback should fire — every Turkish letter is mapped.
        assert!(!bytes.contains(&b'?'), "unexpected '?' fallback in: {:?}", bytes);
    }
}

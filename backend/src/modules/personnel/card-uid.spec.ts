import {
  cardUidHash,
  cardUidLast4,
  isValidCardUid,
  normalizeCardUid,
  staffCardAad,
  STAFF_CARD_HASH_VERSION,
} from "./card-uid";
import {
  decryptString,
  encryptString,
} from "../../common/helpers/encryption.helper";

/**
 * The card UID is an identity-like secret with ~32 bits of entropy. Everything
 * here exists so that (a) the same physical card always resolves to the same
 * person, (b) the same physical card in two tenants never correlates, and
 * (c) an ENCRYPTION_MASTER_KEY rotation does not kill every card in the field.
 */
describe("card-uid", () => {
  const KEY_A = "a".repeat(48);
  const KEY_B = "b".repeat(48);

  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = KEY_A;
  });

  it("normalizes separators, whitespace and case to one canonical UID", () => {
    // The SAME card, as five different readers write it.
    const forms = [
      "04:a2:2b:9c",
      "04 A2 2B 9C",
      " 04a22b9c ",
      "04-a2-2b-9c",
      "04A22B9C",
    ];
    const canonical = forms.map(normalizeCardUid);
    expect(new Set(canonical).size).toBe(1);
    expect(canonical[0]).toBe("04A22B9C");
  });

  it("rejects a UID shorter than 4 or longer than 32 after normalization", () => {
    expect(isValidCardUid("04A2")).toBe(true);
    expect(isValidCardUid("0:4:A")).toBe(false); // 3 chars once stripped
    expect(isValidCardUid("A".repeat(32))).toBe(true);
    expect(isValidCardUid("A".repeat(33))).toBe(false);
    expect(isValidCardUid("::::")).toBe(false); // 0 chars once stripped
  });

  it("produces a DIFFERENT hash for the same card in two tenants", () => {
    // tenantId is mixed INTO the HMAC input, so a stolen database cannot be
    // joined across tenants to say "this person also works there".
    expect(cardUidHash("tenant-a", "04A22B9C")).not.toBe(
      cardUidHash("tenant-b", "04A22B9C"),
    );
  });

  it("is deterministic for the same tenant + card, whatever the reader wrote", () => {
    expect(cardUidHash("t1", "04:a2:2b:9c")).toBe(cardUidHash("t1", "04A22B9C"));
  });

  it("is an HMAC under the master key, not a bare digest", () => {
    // A bare sha256 of a 32-bit UID falls in seconds; the pepper is what makes
    // the stored value useless without the key.
    const withA = cardUidHash("t1", "04A22B9C");
    process.env.ENCRYPTION_MASTER_KEY = KEY_B;
    expect(cardUidHash("t1", "04A22B9C")).not.toBe(withA);
  });

  it("refuses to hash when the master key is absent instead of hashing under ''", () => {
    delete process.env.ENCRYPTION_MASTER_KEY;
    expect(() => cardUidHash("t1", "04A22B9C")).toThrow(
      /ENCRYPTION_MASTER_KEY/,
    );
  });

  it("never returns the raw UID from last4", () => {
    expect(cardUidLast4("04:a2:2b:9c")).toBe("2B9C");
    expect(cardUidLast4("04:a2:2b:9c")).toHaveLength(4);
  });

  it("binds the encrypted copy to tenant AND user", () => {
    expect(staffCardAad("t1", "u1")).toBe("staffcard:v1:t1:u1");
    expect(staffCardAad("t1", "u2")).not.toBe(staffCardAad("t1", "u1"));
  });

  it("can re-derive the hash from the encrypted UID after a key change", () => {
    // K22, the whole reason staffCardUidEnc exists. Without it a rotation
    // kills every card in the field at once and every tenant re-enrols by hand.
    const uid = normalizeCardUid("04:a2:2b:9c");
    const aad = staffCardAad("t1", "u1");
    const blobUnderA = encryptString(uid, aad);
    const hashUnderA = cardUidHash("t1", uid);

    // ...key rotates.
    const recovered = decryptString(blobUnderA, aad); // still the OLD key
    process.env.ENCRYPTION_MASTER_KEY = KEY_B;
    const hashUnderB = cardUidHash("t1", recovered);

    expect(recovered).toBe(uid);
    expect(hashUnderB).not.toBe(hashUnderA);
    expect(hashUnderB).toBe(cardUidHash("t1", "04A22B9C"));
  });

  it("pins the hash scheme version the rotation job filters on", () => {
    expect(STAFF_CARD_HASH_VERSION).toBe(1);
  });
});

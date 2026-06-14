import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AcceptConsentsDto } from "./dto/accept-consents.dto";
import { PublishLegalDocumentDto } from "./dto/publish-document.dto";
import { LegalDocumentKind, CHECKOUT_REQUIRED_KINDS } from "./constants";

/**
 * Long-tail spec for the legal DTOs + constants. Load-bearing rules:
 * checkout consent is EXACTLY three UUIDs (the KVKK/DISTANCE_SALES/REFUND
 * triple); publish requires a semver-ish version + a body capped at 256KB
 * (so a hijacked superadmin can't store a 100MB blob); and the
 * checkout-required kinds list stays the canonical three.
 */
async function errs(dto: object): Promise<string[]> {
  const results = await validate(dto);
  return results.flatMap((e) => Object.values(e.constraints ?? {}));
}

const u = (n: number) =>
  `0c4612e8-18e6-4f16-9edd-844f9369ed0${n}`.slice(0, 36);

describe("AcceptConsentsDto", () => {
  it("accepts exactly three UUIDs", async () => {
    const dto = plainToInstance(AcceptConsentsDto, {
      acceptedDocumentIds: [u(1), u(2), u(3)],
    });
    expect(await errs(dto)).toEqual([]);
  });

  it("rejects fewer than three ids", async () => {
    const dto = plainToInstance(AcceptConsentsDto, {
      acceptedDocumentIds: [u(1), u(2)],
    });
    expect((await errs(dto)).length).toBeGreaterThan(0);
  });

  it("rejects more than three ids", async () => {
    const dto = plainToInstance(AcceptConsentsDto, {
      acceptedDocumentIds: [u(1), u(2), u(3), u(4)],
    });
    expect((await errs(dto)).length).toBeGreaterThan(0);
  });

  it("rejects non-UUID entries", async () => {
    const dto = plainToInstance(AcceptConsentsDto, {
      acceptedDocumentIds: ["a", "b", "c"],
    });
    expect((await errs(dto)).length).toBeGreaterThan(0);
  });
});

describe("PublishLegalDocumentDto", () => {
  const base = {
    kind: LegalDocumentKind.KVKK,
    version: "1.1",
    locale: "tr",
    title: "KVKK",
    bodyMarkdown: "# Policy",
  };

  it("accepts a valid publish payload", async () => {
    expect(await errs(plainToInstance(PublishLegalDocumentDto, base))).toEqual(
      [],
    );
  });

  it("rejects a non-semver version", async () => {
    const dto = plainToInstance(PublishLegalDocumentDto, {
      ...base,
      version: "v1",
    });
    expect((await errs(dto)).some((m) => /version/.test(m))).toBe(true);
  });

  it("rejects an out-of-enum kind", async () => {
    const dto = plainToInstance(PublishLegalDocumentDto, {
      ...base,
      kind: "COOKIES",
    });
    expect((await errs(dto)).some((m) => /kind/.test(m))).toBe(true);
  });

  it("rejects a body over the 256KB cap", async () => {
    const dto = plainToInstance(PublishLegalDocumentDto, {
      ...base,
      bodyMarkdown: "x".repeat(256 * 1024 + 1),
    });
    expect((await errs(dto)).some((m) => /bodyMarkdown/.test(m))).toBe(true);
  });
});

describe("legal constants", () => {
  it("pins the three checkout-blocking document kinds", () => {
    expect(CHECKOUT_REQUIRED_KINDS).toEqual([
      LegalDocumentKind.KVKK,
      LegalDocumentKind.DISTANCE_SALES,
      LegalDocumentKind.REFUND_POLICY,
    ]);
  });
});

import axios from "axios";
import { HttpReferralDirectoryClient } from "./http-referral-directory.client";
import { INTERNAL_REFERRAL_RESOLVE_ROUTE } from "../../core-contracts/referral/http-contract";
import { INTERNAL_TOKEN_HEADER } from "../../core-contracts/internal-http.contract";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Wire-contract tests for the referral resolve client. The marketing side
 * answers 200 with the `{ resolved: ... | null }` ENVELOPE (see
 * core-contracts/referral/http-contract) — a previous version of this client
 * cast the body to the raw DTO, so every successful resolve "validated" as
 * null and attribution silently never happened. These tests pin the
 * envelope unwrap and the never-throw degradation contract.
 */
describe("HttpReferralDirectoryClient", () => {
  let client: HttpReferralDirectoryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new HttpReferralDirectoryClient(
      "http://marketing:3100",
      "secret-token",
    );
  });

  it("POSTs the canonical route with the internal token header", async () => {
    mockedAxios.post.mockResolvedValue({
      status: 200,
      data: { resolved: null },
    });

    await client.resolveReferralCode("AHMET42");

    expect(mockedAxios.post).toHaveBeenCalledWith(
      `http://marketing:3100/api/${INTERNAL_REFERRAL_RESOLVE_ROUTE}`,
      { code: "AHMET42" },
      expect.objectContaining({
        headers: { [INTERNAL_TOKEN_HEADER]: "secret-token" },
      }),
    );
  });

  it("unwraps the { resolved } envelope into the port DTO", async () => {
    mockedAxios.post.mockResolvedValue({
      status: 200,
      data: {
        resolved: { marketingUserId: "m-1", referralCode: "AHMET42" },
      },
    });

    await expect(client.resolveReferralCode("AHMET42")).resolves.toEqual({
      marketingUserId: "m-1",
      referralCode: "AHMET42",
    });
  });

  it("returns null for { resolved: null } (unknown code)", async () => {
    mockedAxios.post.mockResolvedValue({
      status: 200,
      data: { resolved: null },
    });

    await expect(client.resolveReferralCode("NOPE")).resolves.toBeNull();
  });

  it("returns null when the body is not the envelope (defensive)", async () => {
    // e.g. a proxy error page or a peer that violated the contract.
    mockedAxios.post.mockResolvedValue({
      status: 200,
      data: { marketingUserId: "m-1", referralCode: "AHMET42" },
    });

    await expect(client.resolveReferralCode("AHMET42")).resolves.toBeNull();
  });

  it("returns null (never throws) on a non-200 status", async () => {
    mockedAxios.post.mockResolvedValue({ status: 401, data: {} });

    await expect(client.resolveReferralCode("AHMET42")).resolves.toBeNull();
  });

  it("returns null (never throws) on a network failure", async () => {
    mockedAxios.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(client.resolveReferralCode("AHMET42")).resolves.toBeNull();
  });

  it("short-circuits blank input without a network call", async () => {
    await expect(client.resolveReferralCode("   ")).resolves.toBeNull();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

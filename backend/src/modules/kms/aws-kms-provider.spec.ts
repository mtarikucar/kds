import { AwsKmsProvider } from "./aws-kms-provider";

/**
 * The AWS KMS provider is a deliberate fail-loud stub: switching
 * KMS_PROVIDER=aws without installing @aws-sdk/client-kms must surface an
 * actionable error at the call site rather than silently no-op (which would
 * mean tenant credentials are stored unencrypted or fail to decrypt). These
 * specs pin the stub contract so a future real implementation that forgets
 * to remove a throw, or a regression that swallows the error, is caught.
 */
describe("AwsKmsProvider (fail-loud stub)", () => {
  let provider: AwsKmsProvider;

  beforeEach(() => {
    provider = new AwsKmsProvider();
  });

  it("identifies itself as the 'aws' provider", () => {
    expect(provider.id).toBe("aws");
  });

  it("encrypt throws an actionable install error", async () => {
    await expect(
      provider.encrypt({
        plaintext: "secret",
        context: { tenantId: "t1" },
      }),
    ).rejects.toThrow(/install @aws-sdk\/client-kms/);
  });

  it("decrypt throws (delegating to the encrypt() guidance)", async () => {
    await expect(
      provider.decrypt({
        ciphertext: Buffer.from("x"),
        context: { tenantId: "t1" },
      }),
    ).rejects.toThrow(/AwsKmsProvider stub/);
  });

  it("healthCheck reports not-ok with provider + not-implemented detail", async () => {
    const health = await provider.healthCheck();
    expect(health.ok).toBe(false);
    expect(health.details).toMatchObject({
      provider: "aws",
      error: expect.stringContaining("@aws-sdk/client-kms"),
    });
  });
});

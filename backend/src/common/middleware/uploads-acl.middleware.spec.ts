import express from "express";
import request from "supertest";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { createUploadsAclMiddleware } from "./uploads-acl.middleware";

/**
 * Tenant-ACL on statically-served /uploads files.
 *
 * The HOLE: main.ts mounts `app.useStaticAssets(<cwd>/uploads, { prefix:
 * '/uploads/' })` — a blanket express.static with no authorization. Any path
 * a caller can name is served raw, cross-tenant and cross-category. The first
 * describe block reproduces TODAY's behavior and proves a PRIVATE file is
 * readable (RED). The second block proves the allowlist gate closes it while
 * keeping the public-by-design QR-menu assets (logo + product image) served
 * unauthenticated (GREEN + positive).
 */
describe("uploads /uploads ACL", () => {
  let uploadsRoot: string;

  // Layout mirrors the real on-disk structure produced by UploadService:
  //   uploads/products/<tenantId>/<uuid>.jpg   (public — QR menu)
  //   uploads/logos/<tenantId>-logo-*.png      (public — QR menu)
  // plus a hypothetical PRIVATE category that an attacker (or a future
  // feature) could place tenant-internal bytes into:
  //   uploads/documents/<tenantId>/secret.txt  (must NEVER be world-readable)
  const TENANT_A = "tenant-aaaa";
  const TENANT_B = "tenant-bbbb";
  const PRODUCT_FILE_B = "11111111-2222-3333-4444-555555555555.jpg";
  const LOGO_FILE_B = `${TENANT_B}-logo-1700000000000.png`;

  beforeAll(() => {
    uploadsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "uploads-acl-test-"));

    // public: product image for tenant B
    fs.mkdirSync(path.join(uploadsRoot, "products", TENANT_B), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(uploadsRoot, "products", TENANT_B, PRODUCT_FILE_B),
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), // JPEG magic bytes
    );

    // public: logo for tenant B
    fs.mkdirSync(path.join(uploadsRoot, "logos"), { recursive: true });
    fs.writeFileSync(
      path.join(uploadsRoot, "logos", LOGO_FILE_B),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]), // PNG magic bytes
    );

    // PRIVATE: tenant-internal document for tenant B
    fs.mkdirSync(path.join(uploadsRoot, "documents", TENANT_B), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(uploadsRoot, "documents", TENANT_B, "secret.txt"),
      "TENANT-B-CONFIDENTIAL-INVOICE-DATA",
    );

    // A secret outside the uploads root, target of path-traversal attempts.
    fs.writeFileSync(
      path.join(uploadsRoot, "..", "outside-secret.txt"),
      "DO-NOT-LEAK",
    );
  });

  afterAll(() => {
    fs.rmSync(uploadsRoot, { recursive: true, force: true });
    try {
      fs.rmSync(path.join(uploadsRoot, "..", "outside-secret.txt"), {
        force: true,
      });
    } catch {
      /* ignore */
    }
  });

  /**
   * RED — characterizes the CURRENT (vulnerable) blanket-static mount exactly
   * as main.ts:114-116 wires it. This documents the hole: a private file is
   * served to an unauthenticated / cross-tenant caller. This block is expected
   * to PASS (the file IS leaked) on today's behavior, proving the
   * vulnerability is real before we fix it.
   */
  describe("blanket useStaticAssets (today's vulnerable behavior)", () => {
    let app: express.Express;

    beforeAll(() => {
      app = express();
      app.use("/uploads", express.static(uploadsRoot));
    });

    it("LEAKS tenant B's PRIVATE document to an unauthenticated caller", async () => {
      const res = await request(app).get(
        `/uploads/documents/${TENANT_B}/secret.txt`,
      );
      // The vulnerability: 200 + the confidential bytes.
      expect(res.status).toBe(200);
      expect(res.text).toContain("TENANT-B-CONFIDENTIAL-INVOICE-DATA");
    });
  });

  /**
   * GREEN — the allowlist ACL gate. Same uploads root, but private categories
   * and traversal are denied while the public-by-design QR-menu assets stay
   * served unauthenticated.
   */
  describe("createUploadsAclMiddleware (guarded)", () => {
    let app: express.Express;

    beforeAll(() => {
      app = express();
      app.use(
        "/uploads",
        createUploadsAclMiddleware({
          staticHandler: express.static(uploadsRoot),
        }),
      );
    });

    it("DENIES tenant B's private document (was leaked before) → 404", async () => {
      const res = await request(app).get(
        `/uploads/documents/${TENANT_B}/secret.txt`,
      );
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("TENANT-B-CONFIDENTIAL-INVOICE-DATA");
    });

    it("DENIES path traversal to a file outside the uploads root → 404", async () => {
      const res = await request(app)
        .get("/uploads/products/../../outside-secret.txt")
        .redirects(0);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("DO-NOT-LEAK");
    });

    it("DENIES encoded traversal (%2e%2e) → 404", async () => {
      const res = await request(app)
        .get("/uploads/%2e%2e/outside-secret.txt")
        .redirects(0);
      expect([403, 404]).toContain(res.status);
      expect(res.text).not.toContain("DO-NOT-LEAK");
    });

    it("DENIES dotfiles → 404", async () => {
      const res = await request(app).get("/uploads/.env");
      expect(res.status).toBe(404);
    });

    it("DENIES an unknown (non-allowlisted) category → 404", async () => {
      const res = await request(app).get(
        `/uploads/documents/${TENANT_B}/secret.txt`,
      );
      expect(res.status).toBe(404);
    });

    // POSITIVE: public-by-design QR-menu assets stay served unauthenticated.
    it("SERVES a public product image unauthenticated with correct Content-Type", async () => {
      const res = await request(app).get(
        `/uploads/products/${TENANT_B}/${PRODUCT_FILE_B}`,
      );
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/image\/jpeg/);
      // The actual JPEG magic bytes are streamed through unchanged.
      expect(res.body[0]).toBe(0xff);
      expect(res.body[1]).toBe(0xd8);
    });

    it("SERVES a public logo unauthenticated with correct Content-Type", async () => {
      const res = await request(app).get(`/uploads/logos/${LOGO_FILE_B}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/image\/png/);
    });

    it("returns 404 for a missing file inside a public category (not a 500/leak)", async () => {
      const res = await request(app).get(
        `/uploads/products/${TENANT_A}/does-not-exist.jpg`,
      );
      expect(res.status).toBe(404);
    });
  });
});

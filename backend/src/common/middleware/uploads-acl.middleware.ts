import type { Request, Response, NextFunction, RequestHandler } from "express";
import * as path from "path";

/**
 * Tenant ACL / allowlist gate for statically-served `/uploads/` files.
 *
 * THREAT: `app.useStaticAssets(<cwd>/uploads, { prefix: '/uploads/' })` is a
 * blanket file server with NO authorization. Anyone who knows or guesses a
 * path reads the raw bytes of ANY file under the uploads root, across tenants
 * and across categories. `tenantId` is embedded in product-image paths but it
 * is an identifier, not a secret, so it provides no protection.
 *
 * DESIGN NUANCE (verified in the codebase before writing this):
 *   - `uploads/logos/${tenantId}-logo-*.png`  → restaurant logo
 *   - `uploads/products/${tenantId}/${uuid}.jpg` → product images
 * BOTH of these are rendered on the PUBLIC, unauthenticated QR menu
 * (`qr-menu.controller.ts` is `@Public()` and returns `settings.logoUrl`
 * plus each product's `images[].url`). The browser fetches them via plain
 * `<img src>` tags that carry NO JWT. A strict "request scope tenantId must
 * equal the path tenantId" rule would therefore 403 every public-menu image
 * and break the product. So those two categories are public-by-design and
 * must stay unauthenticated.
 *
 * There is currently NO private upload category (no documents / invoices /
 * hardware files are written to disk — those words refer to checkout/order DB
 * records, not file uploads). The risk is thus twofold:
 *   1. an attacker walking OUTSIDE the intended public set (path traversal,
 *      dotfiles, arbitrary subpaths), and
 *   2. a FUTURE private category being added and silently inheriting the
 *      world-readable blanket-static behavior.
 *
 * This gate closes both by switching from deny-nothing to ALLOWLIST: only the
 * explicitly-public category prefixes are served; every other path under
 * `/uploads/` is rejected (404 — indistinguishable from "no such file", so we
 * don't confirm existence of anything private). Content-Type and streaming are
 * preserved because the actual file serve is still delegated to the supplied
 * static handler (express.static) after the gate passes.
 *
 * When a genuinely-private, per-tenant category is later introduced, register
 * it here with a `requireTenantMatch` rule rather than adding it to the public
 * allowlist — see {@link UploadsCategoryRule}.
 */

/** First path segment under `/uploads/` that is public-by-design. */
export const PUBLIC_UPLOAD_CATEGORIES = ["products", "logos"] as const;

export interface UploadsAclOptions {
  /**
   * The real static file handler (normally `express.static(uploadsRoot)`).
   * Injected so the ACL can be unit-tested with a stub and so the production
   * Content-Type/streaming/etag behavior is byte-for-byte the express.static
   * behavior the blanket mount previously had.
   */
  staticHandler: RequestHandler;
  /**
   * Categories whose files are public-by-design (served unauthenticated).
   * Defaults to {@link PUBLIC_UPLOAD_CATEGORIES}.
   */
  publicCategories?: readonly string[];
}

/**
 * Normalize the request path (the part AFTER the `/uploads/` prefix, i.e.
 * express strips the mount prefix into `req.path`) into a clean POSIX-style
 * relative path, collapsing `.`/`..` segments. Returns `null` if the path
 * tries to escape the root or is otherwise unsafe.
 */
function normalizeRelPath(reqPath: string): string | null {
  // express has already URL-decoded req.path. Strip a leading slash so
  // path.posix.normalize treats it as relative.
  let decoded: string;
  try {
    // Defense-in-depth: handle any residual percent-encoding (e.g. %2e%2e).
    decoded = decodeURIComponent(reqPath);
  } catch {
    return null; // malformed percent-encoding
  }
  // Reject NUL bytes outright.
  if (decoded.includes("\0")) return null;
  const rel = decoded.replace(/^\/+/, "");
  // Normalize using POSIX semantics regardless of host OS so back-slashes are
  // treated as literal filename chars, not separators (Windows quirk).
  const normalized = path.posix.normalize(rel);
  // After normalization, any escape attempt surfaces as a leading `..`.
  if (normalized === ".." || normalized.startsWith("../")) return null;
  if (path.posix.isAbsolute(normalized)) return null;
  return normalized;
}

/**
 * Build the Express middleware that gates `/uploads/` access. Mount it at the
 * same prefix the blanket static mount used (`/uploads/`).
 */
export function createUploadsAclMiddleware(
  options: UploadsAclOptions,
): RequestHandler {
  const publicCategories = new Set(
    options.publicCategories ?? PUBLIC_UPLOAD_CATEGORIES,
  );
  const staticHandler = options.staticHandler;

  return (req: Request, res: Response, next: NextFunction): void => {
    // Only GET/HEAD are ever valid for static reads.
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(404).end();
      return;
    }

    const rel = normalizeRelPath(req.path);
    if (rel === null || rel === "" || rel === ".") {
      // Traversal attempt, escape, or directory root request → not found.
      res.status(404).end();
      return;
    }

    // Reject dotfiles anywhere in the path (e.g. `.env`, `.git/...`).
    if (rel.split("/").some((seg) => seg.startsWith("."))) {
      res.status(404).end();
      return;
    }

    const firstSegment = rel.split("/")[0];

    // ALLOWLIST: only known public categories are served. Anything else
    // (including any future private category) is denied by default.
    if (!publicCategories.has(firstSegment)) {
      res.status(404).end();
      return;
    }

    // Public category → delegate to express.static for correct Content-Type,
    // ETag, range/streaming and 404-on-missing behavior.
    staticHandler(req, res, next);
  };
}

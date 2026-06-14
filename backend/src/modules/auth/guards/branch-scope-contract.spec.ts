import * as fs from "fs";
import * as path from "path";

/**
 * System-wide branch-scope CONTRACT fitness test.
 *
 * v3 registers BranchGuard globally (APP_GUARD in auth.module.ts), so EVERY
 * route requires an `X-Branch-Id` header unless it opts out. Account-level
 * self-service routes (`/users/me/*`, etc.) are NOT branch-scoped and MUST opt
 * out — otherwise they 400 ("X-Branch-Id header required") whenever the client
 * hasn't selected a branch yet (e.g. right after login). A missing `@SkipBranchScope`
 * on `GET /users/me/profile` shipped exactly this regression: the profile page
 * silently rendered blank.
 *
 * This test scans every controller and asserts the invariant statically, so the
 * same class of bug can't recur unnoticed on any new `/me` route. It is
 * DB-free and runs in the standard `jest` gate.
 *
 * A route is "branch-exempt" if it (or its controller class) carries one of:
 *   @SkipBranchScope | @Public | @SuperAdminPublic | @SuperAdminRoute | @MarketingRoute
 * (the first skips BranchGuard; the rest bypass all global auth via
 * shouldBypassGlobalAuth() — see guard-bypass.helper.ts).
 */

const MODULES_DIR = path.resolve(__dirname, "../../../modules");

const EXEMPT_MARKERS = [
  "@SkipBranchScope",
  "@Public",
  "@SuperAdminPublic",
  "@SuperAdminRoute",
  "@MarketingRoute",
];

const ROUTE_RE = /@(Get|Post|Patch|Put|Delete)\(\s*["'`]([^"'`]*)["'`]/;
const ROUTE_NO_PATH_RE = /@(Get|Post|Patch|Put|Delete)\(\s*\)/;
const CONTROLLER_RE = /@Controller\(\s*["'`]([^"'`]*)["'`]/;

function walkControllers(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkControllers(full));
    else if (entry.name.endsWith(".controller.ts") && !entry.name.endsWith(".spec.ts"))
      out.push(full);
  }
  return out;
}

interface RouteInfo {
  file: string;
  fullPath: string;
  method: string;
  exempt: boolean;
}

function hasMarker(text: string): boolean {
  return EXEMPT_MARKERS.some((m) => text.includes(m));
}

/** Split a controller file into blank-line-separated chunks (one method's
 * decorator block + signature lands in a single chunk under the house style). */
function parseController(file: string): RouteInfo[] {
  const src = fs.readFileSync(file, "utf8");

  const ctrlMatch = src.match(CONTROLLER_RE);
  const base = ctrlMatch ? ctrlMatch[1].replace(/^\/+|\/+$/g, "") : "";

  // Class-level exemption: markers applied above `export class` (the class
  // decorator stack). Approximate as markers appearing before the class line.
  const classLine = src.indexOf("export class");
  const classHead = classLine >= 0 ? src.slice(0, classLine) : src;
  // Only count markers in the class decorator block (after @Controller), not
  // in imports — imports reference the symbol without the leading "@".
  const classDecoratorBlock = ctrlMatch
    ? classHead.slice(classHead.indexOf(ctrlMatch[0]))
    : "";
  const classExempt = hasMarker(classDecoratorBlock);

  const routes: RouteInfo[] = [];
  for (const chunk of src.split(/\n\s*\n/)) {
    if (!/@(Get|Post|Patch|Put|Delete)\(/.test(chunk)) continue;
    const exempt = classExempt || hasMarker(chunk);
    // A chunk usually holds exactly one route decorator, but handle several.
    const re = new RegExp(ROUTE_RE.source, "g");
    let m: RegExpExecArray | null;
    let matchedAny = false;
    while ((m = re.exec(chunk)) !== null) {
      matchedAny = true;
      const sub = m[2].replace(/^\/+|\/+$/g, "");
      const fullPath = [base, sub].filter(Boolean).join("/");
      routes.push({ file, fullPath, method: m[1], exempt });
    }
    if (!matchedAny && ROUTE_NO_PATH_RE.test(chunk)) {
      const method = (chunk.match(ROUTE_NO_PATH_RE) as RegExpMatchArray)[1];
      routes.push({ file, fullPath: base, method, exempt });
    }
  }
  return routes;
}

function segments(p: string): string[] {
  return p.split("/").filter(Boolean);
}

describe("branch-scope contract (system-wide guard fitness)", () => {
  const allRoutes: RouteInfo[] = walkControllers(MODULES_DIR).flatMap(parseController);

  it("discovers a meaningful number of routes (parser sanity)", () => {
    // Guards against a silently-broken parser making the suite vacuously pass.
    expect(allRoutes.length).toBeGreaterThan(200);
  });

  it("every account self-service `/me` route opts out of BranchGuard", () => {
    // /me routes are the user's own account — not branch-scoped. Each must be
    // @SkipBranchScope (or otherwise bypass global auth), or it 400s when no
    // branch is selected. This is the exact regression that blanked the
    // profile page.
    const meRoutes = allRoutes.filter((r) => segments(r.fullPath).includes("me"));
    expect(meRoutes.length).toBeGreaterThan(0); // parser found the /me routes

    const offenders = meRoutes
      .filter((r) => !r.exempt)
      .map((r) => `${r.method} /${r.fullPath}  (${path.basename(r.file)})`);

    expect(offenders).toEqual([]);
  });

  it("the specific /users/me/profile regression stays fixed", () => {
    const profile = allRoutes.filter((r) => r.fullPath === "users/me/profile");
    expect(profile.length).toBeGreaterThanOrEqual(1); // GET + PATCH
    for (const r of profile) expect(r.exempt).toBe(true);
  });
});

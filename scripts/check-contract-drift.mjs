#!/usr/bin/env node
/**
 * Contract-drift guard: backend and frontend deliberately mirror a handful
 * of constants (the frontend can't import backend source — Docker builds
 * use per-app contexts, see docker-compose.prod.yml). Until a shared
 * contracts package exists (ADR-0002), this script is the enforcement:
 * it parses both sides from source and fails CI on any mismatch.
 *
 * Run from the repo root:  node scripts/check-contract-drift.mjs
 *
 * Adding a mirrored constant? Add a CHECKS entry below.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const read = (relPath) => readFileSync(join(repoRoot, relPath), "utf8");

/** Extract `["A", "B", ...]` from `export enum Name { A = "A", B = "B" }`. */
function enumValues(source, enumName, file) {
  const match = source.match(
    new RegExp(`export enum ${enumName}\\s*\\{([\\s\\S]*?)\\}`),
  );
  if (!match) {
    throw new Error(`enum ${enumName} not found in ${file}`);
  }
  return [...match[1].matchAll(/=\s*["']([A-Z_]+)["']/g)].map((m) => m[1]);
}

/** Extract `["WAITER", ...]` from `... HARD_RESTRICTED_ROLES ... = [UserRole.WAITER, ...]`. */
function roleListValues(source, constName, file) {
  const match = source.match(
    new RegExp(`${constName}[^=]*=\\s*\\[([\\s\\S]*?)\\]`),
  );
  if (!match) {
    throw new Error(`const ${constName} not found in ${file}`);
  }
  return [...match[1].matchAll(/UserRole\.([A-Z_]+)/g)].map((m) => m[1]);
}

const BACKEND_ROLES = "backend/src/common/constants/roles.enum.ts";
const BACKEND_ORDER = "backend/src/common/constants/order-status.enum.ts";
const FRONTEND_TYPES = "frontend/src/types/index.ts";
const FRONTEND_ROLES = "frontend/src/types/roles.ts";

const CHECKS = [
  {
    name: "UserRole",
    backend: () => enumValues(read(BACKEND_ROLES), "UserRole", BACKEND_ROLES),
    frontend: () =>
      enumValues(read(FRONTEND_TYPES), "UserRole", FRONTEND_TYPES),
  },
  {
    name: "HARD_RESTRICTED_ROLES",
    backend: () =>
      roleListValues(read(BACKEND_ROLES), "HARD_RESTRICTED_ROLES", BACKEND_ROLES),
    frontend: () =>
      roleListValues(read(FRONTEND_ROLES), "HARD_RESTRICTED_ROLES", FRONTEND_ROLES),
  },
  {
    name: "OrderStatus",
    backend: () =>
      enumValues(read(BACKEND_ORDER), "OrderStatus", BACKEND_ORDER),
    frontend: () =>
      enumValues(read(FRONTEND_TYPES), "OrderStatus", FRONTEND_TYPES),
  },
  {
    name: "OrderType",
    backend: () => enumValues(read(BACKEND_ORDER), "OrderType", BACKEND_ORDER),
    frontend: () =>
      enumValues(read(FRONTEND_TYPES), "OrderType", FRONTEND_TYPES),
  },
  {
    name: "PaymentStatus",
    backend: () =>
      enumValues(read(BACKEND_ORDER), "PaymentStatus", BACKEND_ORDER),
    frontend: () =>
      enumValues(read(FRONTEND_TYPES), "PaymentStatus", FRONTEND_TYPES),
  },
];

let failures = 0;
for (const check of CHECKS) {
  let backend, frontend;
  try {
    backend = check.backend();
    frontend = check.frontend();
  } catch (err) {
    failures += 1;
    console.error(`✗ ${check.name}: ${err.message}`);
    continue;
  }

  const missingInFrontend = backend.filter((v) => !frontend.includes(v));
  const missingInBackend = frontend.filter((v) => !backend.includes(v));
  if (missingInFrontend.length === 0 && missingInBackend.length === 0) {
    console.log(`✓ ${check.name} (${backend.length} values)`);
    continue;
  }

  failures += 1;
  console.error(`✗ ${check.name} drifted:`);
  if (missingInFrontend.length > 0) {
    console.error(`    backend-only values: ${missingInFrontend.join(", ")}`);
  }
  if (missingInBackend.length > 0) {
    console.error(`    frontend-only values: ${missingInBackend.join(", ")}`);
  }
}

/* ------------------------------------------------------------------------- *
 * Branch-scope mirror: backend class-level @SkipBranchScope ↔ frontend
 * TENANT_WIDE_PATH_PREFIXES.
 *
 * v3 registers BranchGuard globally, so the SPA's axios interceptor strips
 * X-Branch-Id for routes it classifies tenant-wide (TENANT_WIDE_PATH_PREFIXES
 * in frontend/src/lib/api.ts) and fail-fasts everything else when no branch is
 * resolved. A controller marked class-level @SkipBranchScope is a whole
 * tenant-level resource the authenticated SPA calls without a branch — every
 * one of its routes MUST therefore be matched by a frontend tenant-wide
 * prefix, or the SPA blanks/400s before a branch is picked (the exact
 * /pos-settings and /users/me/profile regression class).
 *
 * Method-level @SkipBranchScope and @Public / @SuperAdminRoute exemptions are
 * deliberately NOT checked here: those routes are either called pre-auth or
 * are individually exempt, and several legitimate frontend prefixes (/auth/,
 * /me, /superadmin/, /billing/) come from those mechanisms, not class-level
 * skips — so the reverse direction would false-positive.
 * ------------------------------------------------------------------------- */

/** Mirror of frontend isTenantWidePath() — keep in lockstep with api.ts. */
function isTenantWidePath(path, prefixes) {
  if (!path) return false;
  const p = path.split("?")[0];
  return prefixes.some((pre) => {
    const idx = p.indexOf(pre);
    if (idx === -1) return false;
    if (pre.endsWith("/")) return true;
    const after = p.charAt(idx + pre.length);
    return after === "" || after === "/";
  });
}

function frontendTenantWidePrefixes() {
  const file = "frontend/src/lib/api.ts";
  const src = read(file);
  const m = src.match(/TENANT_WIDE_PATH_PREFIXES\s*=\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error(`TENANT_WIDE_PATH_PREFIXES not found in ${file}`);
  // Strip // line comments first — a stray apostrophe in a comment
  // ("fail-fast'd") would otherwise be parsed as a string delimiter.
  const body = m[1]
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  const prefixes = [...body.matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]);
  if (prefixes.length === 0)
    throw new Error(`TENANT_WIDE_PATH_PREFIXES parsed empty in ${file}`);
  return prefixes;
}

function walkControllers(dir) {
  const out = [];
  for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkControllers(rel));
    else if (entry.name.endsWith(".controller.ts")) out.push(rel);
  }
  return out;
}

/** A @SkipBranchScope inside the contiguous decorator stack attached to the
 * class (decorators must sit immediately above `export class`, with no blank
 * line between them, regardless of their order relative to @Controller). */
function hasClassLevelSkip(src) {
  const cm = src.match(/export class \w+/);
  if (!cm) return false;
  const before = src.slice(0, src.indexOf(cm[0]));
  const lines = before.split("\n");
  // The slice ends on the newline right before `export class`, leaving a
  // trailing empty element — drop those before walking the decorator stack.
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  const block = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === "") break;
    block.unshift(lines[i]);
  }
  return block.join("\n").includes("@SkipBranchScope");
}

function controllerBase(src) {
  const m = src.match(/@Controller\(\s*["'`]([^"'`]*)["'`]/);
  return m ? m[1].replace(/^\/+|\/+$/g, "") : "";
}

/** Full route paths ("/base/sub") for every HTTP method handler. */
function routePaths(src, base) {
  const paths = [];
  const re = /@(?:Get|Post|Patch|Put|Delete)\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const q = m[1].match(/["'`]([^"'`]*)["'`]/);
    const sub = q ? q[1].replace(/^\/+|\/+$/g, "") : "";
    paths.push("/" + [base, sub].filter(Boolean).join("/"));
  }
  return paths;
}

try {
  const prefixes = frontendTenantWidePrefixes();
  const controllers = walkControllers("backend/src/modules").filter(
    (f) => !f.endsWith(".spec.ts"),
  );

  const classLevel = [];
  for (const f of controllers) {
    const src = read(f);
    if (!hasClassLevelSkip(src)) continue;
    const base = controllerBase(src);
    classLevel.push({ file: f, base, routes: routePaths(src, base) });
  }

  if (classLevel.length === 0) {
    throw new Error(
      "found 0 class-level @SkipBranchScope controllers — parser likely broke",
    );
  }

  const offenders = [];
  for (const c of classLevel) {
    for (const route of c.routes) {
      if (!isTenantWidePath(route, prefixes)) {
        offenders.push(`${route}  (${c.file.split("/").pop()})`);
      }
    }
  }

  if (offenders.length === 0) {
    console.log(
      `✓ branch-scope mirror (${classLevel.length} class-level @SkipBranchScope controllers, all routes tenant-wide on the frontend)`,
    );
  } else {
    failures += 1;
    console.error(
      "✗ branch-scope mirror drifted — backend class-level @SkipBranchScope routes NOT covered by frontend TENANT_WIDE_PATH_PREFIXES:",
    );
    for (const o of offenders) console.error(`    ${o}`);
    console.error(
      "    Add a matching prefix to TENANT_WIDE_PATH_PREFIXES in frontend/src/lib/api.ts.",
    );
  }
} catch (err) {
  failures += 1;
  console.error(`✗ branch-scope mirror: ${err.message}`);
}

if (failures > 0) {
  console.error(
    `\n${failures} mirrored contract(s) drifted. Align the values above (the backend is the source of truth) or update CHECKS if a mirror was intentionally retired.`,
  );
  process.exit(1);
}
console.log("\nAll mirrored contracts in sync.");

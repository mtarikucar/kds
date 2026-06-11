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
import { readFileSync } from "node:fs";
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

if (failures > 0) {
  console.error(
    `\n${failures} mirrored contract(s) drifted. Align the values above (the backend is the source of truth) or update CHECKS if a mirror was intentionally retired.`,
  );
  process.exit(1);
}
console.log("\nAll mirrored contracts in sync.");

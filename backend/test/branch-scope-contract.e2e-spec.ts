import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Test } from "@nestjs/testing";
import { DiscoveryModule, DiscoveryService, Reflector } from "@nestjs/core";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { AppModule } from "../src/app.module";
import { IS_PUBLIC_KEY } from "../src/modules/auth/decorators/public.decorator";
import { IS_MACHINE_AUTH_KEY } from "../src/modules/auth/decorators/machine-auth.decorator";
import { IS_SKIP_BRANCH_SCOPE_KEY } from "../src/modules/auth/decorators/skip-branch-scope.decorator";
import {
  IS_SUPERADMIN_PUBLIC_KEY,
  IS_SUPERADMIN_ROUTE_KEY,
} from "../src/modules/superadmin/decorators/superadmin.decorator";

/**
 * Branch-scope contract guard (direction A).
 *
 * The SPA's axios interceptor STRIPS X-Branch-Id for any path matched by
 * frontend TENANT_WIDE_PATH_PREFIXES. The global BranchGuard 400s any route
 * that is not BranchGuard-exempt when the header is absent. So EVERY backend
 * route whose full path is tenant-wide on the frontend MUST be exempt
 * (@Public / @SkipBranchScope / superadmin), or it 400s in prod.
 *
 * This is the class of bug behind v3.2.19 (auth routes) and the webhooks/health
 * collisions: '/subscriptions' matched '/v1/webhooks/subscriptions', '/branches'
 * matched '/v1/health/branches'. The existing contract-drift script only checks
 * the reverse direction (class-level skip ↔ tenant-wide), so this runtime check
 * closes the gap by reading the REAL route metadata.
 */
const HTTP = [
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "ALL",
  "OPTIONS",
  "HEAD",
];

function tenantWidePrefixes(): string[] {
  const file = join(__dirname, "../../frontend/src/lib/api.ts");
  const src = readFileSync(file, "utf8");
  const m = src.match(/TENANT_WIDE_PATH_PREFIXES\s*=\s*\[([\s\S]*?)\]/);
  if (!m) throw new Error(`TENANT_WIDE_PATH_PREFIXES not found in ${file}`);
  const body = m[1]
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
  const out = [...body.matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]);
  if (out.length === 0)
    throw new Error("TENANT_WIDE_PATH_PREFIXES parsed empty");
  return out;
}

/** Mirror of frontend isTenantWidePath() (frontend/src/lib/api.ts). */
function isTenantWide(path: string, prefixes: string[]): boolean {
  const p = path.split("?")[0];
  return prefixes.some((pre) => {
    const idx = p.indexOf(pre);
    if (idx === -1) return false;
    if (pre.endsWith("/")) return true;
    const after = p.charAt(idx + pre.length);
    return after === "" || after === "/";
  });
}

function joinPath(base: unknown, sub: unknown): string {
  const norm = (s: unknown) => String(s ?? "").replace(/^\/+|\/+$/g, "");
  return "/" + [norm(base), norm(sub)].filter(Boolean).join("/");
}

describe("Branch-scope contract (direction A)", () => {
  it("every tenant-wide frontend path maps to a BranchGuard-exempt backend route", async () => {
    const prefixes = tenantWidePrefixes();
    const mod = await Test.createTestingModule({
      imports: [AppModule, DiscoveryModule],
    }).compile();
    const app = mod.createNestApplication();
    await app.init();

    const discovery = app.get(DiscoveryService);
    const reflector = app.get(Reflector);

    const violations: string[] = [];

    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance;
      const metatype = wrapper.metatype as any;
      if (!instance || !metatype) continue;

      const ctrlPath = reflector.get(PATH_METADATA, metatype);
      const proto = Object.getPrototypeOf(instance);

      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === "constructor") continue;
        const handler = proto[name];
        if (typeof handler !== "function") continue;
        const methodPath = reflector.get(PATH_METADATA, handler);
        if (methodPath === undefined) continue; // not a route handler

        const full = joinPath(ctrlPath, methodPath);
        if (!isTenantWide(full, prefixes)) continue;

        const targets = [handler, metatype];
        const exempt =
          !!reflector.getAllAndOverride(IS_PUBLIC_KEY, targets) ||
          // @MachineAuth (partner key / screen token) bypasses the global
          // BranchGuard via shouldBypassGlobalAuth, so these routes never need
          // X-Branch-Id — a legitimate exemption category.
          !!reflector.getAllAndOverride(IS_MACHINE_AUTH_KEY, targets) ||
          !!reflector.getAllAndOverride(IS_SKIP_BRANCH_SCOPE_KEY, targets) ||
          !!reflector.getAllAndOverride(IS_SUPERADMIN_PUBLIC_KEY, targets) ||
          !!reflector.getAllAndOverride(IS_SUPERADMIN_ROUTE_KEY, targets);

        if (!exempt) {
          const verb = HTTP[reflector.get(METHOD_METADATA, handler)] ?? "?";
          violations.push(`${verb} ${full}  (${metatype.name}.${name})`);
        }
      }
    }

    await app.close();

    if (violations.length > 0) {
      throw new Error(
        "Tenant-wide frontend paths whose backend route is NOT BranchGuard-exempt " +
          "(these 400 in prod — add @SkipBranchScope or fix the tenant-wide prefix):\n  " +
          violations.join("\n  "),
      );
    }
    expect(violations).toEqual([]);
  });
});

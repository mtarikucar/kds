import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  UseGuards,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { BranchGuard } from "./branch.guard";
import { SkipBranchScope } from "../decorators/skip-branch-scope.decorator";
import { PrismaService } from "../../../prisma/prisma.service";

/**
 * Behavioral smoke test for the global v3 BranchGuard, run end-to-end through a
 * real Nest HTTP app (no DB — PrismaService is mocked). It pins the contract
 * that the static branch-scope-contract.spec asserts structurally:
 *   - @SkipBranchScope routes serve WITHOUT an X-Branch-Id header (the /me fix)
 *   - branch-scoped routes 400 without the header, 200 with a valid one,
 *     403 when the branch is cross-tenant or outside the role's allow-list,
 *     and 401 when the user carries no tenant.
 * Runs in the standard `jest` gate.
 */

const T1 = "11111111-1111-1111-1111-111111111111";
const B1 = "22222222-2222-2222-2222-222222222222";
const B2 = "44444444-4444-4444-4444-444444444444";
const B_OTHER = "33333333-3333-3333-3333-333333333333";

// Branches the (mock) DB considers active members of tenant T1.
const VALID_BRANCHES = new Set([B1, B2]);

// Mutable so each test shapes req.user before issuing its request.
let testUser: any;

@Injectable()
class StubAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    ctx.switchToHttp().getRequest().user = testUser;
    return true;
  }
}

@Controller("branch-test")
@UseGuards(StubAuthGuard, BranchGuard)
class BranchTestController {
  @SkipBranchScope()
  @Get("exempt")
  exempt() {
    return { route: "exempt" };
  }

  @Get("scoped")
  scoped() {
    return { route: "scoped" };
  }
}

const prismaMock = {
  branch: {
    findFirst: jest.fn(({ where }: any) =>
      Promise.resolve(
        where?.tenantId === T1 &&
          where?.status === "active" &&
          VALID_BRANCHES.has(where?.id)
          ? { id: where.id }
          : null,
      ),
    ),
  },
};

describe("BranchGuard behavior (e2e smoke through a Nest app)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BranchTestController],
      providers: [
        StubAuthGuard,
        BranchGuard,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Default: an owner ADMIN with wildcard branch access.
    testUser = {
      id: "u1",
      tenantId: T1,
      role: "ADMIN",
      primaryBranchId: null,
      allowedBranchIds: [],
    };
    prismaMock.branch.findFirst.mockClear();
  });

  const http = () => request(app.getHttpServer());

  it("exempt (@SkipBranchScope) route serves WITHOUT X-Branch-Id", async () => {
    await http().get("/branch-test/exempt").expect(200, { route: "exempt" });
  });

  it("branch-scoped route WITHOUT X-Branch-Id → 400", async () => {
    const res = await http().get("/branch-test/scoped").expect(400);
    expect(JSON.stringify(res.body)).toMatch(/X-Branch-Id/i);
  });

  it("branch-scoped route WITH a valid header → 200", async () => {
    await http()
      .get("/branch-test/scoped")
      .set("X-Branch-Id", B1)
      .expect(200, { route: "scoped" });
  });

  it("branch-scoped route WITH a cross-tenant/unknown branch → 403", async () => {
    await http().get("/branch-test/scoped").set("X-Branch-Id", B_OTHER).expect(403);
  });

  it("a malformed X-Branch-Id is dropped → treated as missing (400)", async () => {
    await http().get("/branch-test/scoped").set("X-Branch-Id", "not-a-uuid").expect(400);
  });

  it("a tenantless user is rejected (401) on a scoped route", async () => {
    testUser = { id: "u2", tenantId: null, role: "ADMIN" };
    await http().get("/branch-test/scoped").set("X-Branch-Id", B1).expect(401);
  });

  it("MANAGER allow-list: in-list branch → 200, out-of-list (but valid) → 403", async () => {
    testUser = {
      id: "u3",
      tenantId: T1,
      role: "MANAGER",
      primaryBranchId: null,
      allowedBranchIds: [B1],
    };
    await http().get("/branch-test/scoped").set("X-Branch-Id", B1).expect(200);
    // B2 is a real active branch in the tenant but not in the manager's
    // allow-list → 403 from the role-conditional check (not the existence check).
    await http().get("/branch-test/scoped").set("X-Branch-Id", B2).expect(403);
  });
});

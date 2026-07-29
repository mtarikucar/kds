import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  ValidationPipe,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { CategoriesController } from "./categories.controller";
import { ProductsController } from "./products.controller";
import { CategoriesService } from "../services/categories.service";
import { ProductsService } from "../services/products.service";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../auth/guards/roles.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import { PlanFeatureGuard } from "../../subscriptions/guards/plan-feature.guard";

/**
 * HTTP-level routing spec for the batch reorder endpoints, run through a real
 * Nest app (services mocked, guards stubbed) — the same in-unit-gate supertest
 * pattern as branch-scope.behavior.spec.ts. It pins the ROUTE-ORDER footgun:
 * Nest matches routes in declaration order, so @Patch("reorder") must be
 * declared BEFORE @Patch(":id") or the literal path is swallowed as
 * :id="reorder" and dispatched to the update handler. A pure
 * controller-instance spec cannot see that; only real routing can.
 * Also exercises the ReorderMenuDto validation (empty / duplicate ids → 400).
 */

@Injectable()
class StubTenantGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    ctx.switchToHttp().getRequest().tenantId = "t1";
    return true;
  }
}

const passGuard = { canActivate: () => true };

describe("menu reorder routing (real HTTP)", () => {
  let app: INestApplication;
  let categoriesSvc: Record<string, jest.Mock>;
  let productsSvc: Record<string, jest.Mock>;

  beforeAll(async () => {
    categoriesSvc = {
      reorder: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: "c1" }),
    };
    productsSvc = {
      reorderProducts: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: "p1" }),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [CategoriesController, ProductsController],
      providers: [
        { provide: CategoriesService, useValue: categoriesSvc },
        { provide: ProductsService, useValue: productsSvc },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(passGuard)
      .overrideGuard(TenantGuard)
      .useClass(StubTenantGuard)
      .overrideGuard(RolesGuard)
      .useValue(passGuard)
      .overrideGuard(PlanFeatureGuard)
      .useValue(passGuard)
      .compile();

    app = moduleRef.createNestApplication();
    // Mirror main.ts's pipe exactly so the DTO validation is exercised for real.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: false,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("PATCH /menu/categories/reorder hits the batch handler, NOT update(':id')", async () => {
    await request(app.getHttpServer())
      .patch("/menu/categories/reorder")
      .send({ orderedIds: ["c2", "c1"] })
      .expect(200);

    expect(categoriesSvc.reorder).toHaveBeenCalledWith(["c2", "c1"], "t1");
    expect(categoriesSvc.update).not.toHaveBeenCalled();
  });

  it("PATCH /menu/categories/:id still reaches the update handler", async () => {
    await request(app.getHttpServer())
      .patch("/menu/categories/c-123")
      .send({ name: "Renamed" })
      .expect(200);

    expect(categoriesSvc.update).toHaveBeenCalledWith(
      "c-123",
      expect.objectContaining({ name: "Renamed" }),
      "t1",
    );
    expect(categoriesSvc.reorder).not.toHaveBeenCalled();
  });

  it("PATCH /menu/products/reorder hits the batch handler, NOT update(':id')", async () => {
    await request(app.getHttpServer())
      .patch("/menu/products/reorder")
      .send({ orderedIds: ["p2", "p1"] })
      .expect(200);

    expect(productsSvc.reorderProducts).toHaveBeenCalledWith(
      ["p2", "p1"],
      "t1",
    );
    expect(productsSvc.update).not.toHaveBeenCalled();
  });

  it("PATCH /menu/products/:id still reaches the update handler", async () => {
    await request(app.getHttpServer())
      .patch("/menu/products/p-9")
      .send({ price: 9.5 })
      .expect(200);

    expect(productsSvc.update).toHaveBeenCalledWith(
      "p-9",
      expect.objectContaining({ price: 9.5 }),
      "t1",
    );
    expect(productsSvc.reorderProducts).not.toHaveBeenCalled();
  });

  it.each([
    ["missing orderedIds", {}],
    ["empty orderedIds", { orderedIds: [] }],
    ["duplicate ids", { orderedIds: ["a", "a"] }],
    ["non-string entries", { orderedIds: [1, 2] }],
  ])("rejects %s with 400 before the service runs", async (_label, body) => {
    await request(app.getHttpServer())
      .patch("/menu/categories/reorder")
      .send(body)
      .expect(400);
    await request(app.getHttpServer())
      .patch("/menu/products/reorder")
      .send(body)
      .expect(400);

    expect(categoriesSvc.reorder).not.toHaveBeenCalled();
    expect(productsSvc.reorderProducts).not.toHaveBeenCalled();
  });
});

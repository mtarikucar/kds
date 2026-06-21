import { ProductsController } from "./products.controller";

/**
 * Thin-controller spec for ProductsController. Verifies each handler forwards
 * req.tenantId (+ id/body params), that findAll maps categoryId + the optional
 * ListQueryDto into the service options, and that the @Body('quantity')/
 * @Body('imageIds') extractions reach the service unchanged.
 */
describe("ProductsController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: ProductsController;
  const req = { tenantId: "t1" };

  beforeEach(() => {
    svc = {
      create: jest.fn().mockResolvedValue({ id: "p1" }),
      findAll: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue({ id: "p1" }),
      update: jest.fn().mockResolvedValue({ id: "p1" }),
      remove: jest.fn().mockResolvedValue({ id: "p1" }),
      updateStock: jest.fn().mockResolvedValue({ id: "p1" }),
      getProductImages: jest.fn().mockResolvedValue([]),
      reorderProductImages: jest.fn().mockResolvedValue([]),
      removeImageFromProduct: jest.fn().mockResolvedValue({ id: "p1" }),
    };
    ctrl = new ProductsController(svc as any);
  });

  it("create forwards dto + tenantId", () => {
    const dto = { name: "Pizza" } as any;
    ctrl.create(dto, req as any);
    expect(svc.create).toHaveBeenCalledWith(dto, "t1");
  });

  it("findAll forwards categoryId + mapped limit/offset", () => {
    ctrl.findAll(req as any, "cat-1", undefined, {
      limit: 20,
      offset: 0,
    } as any);
    expect(svc.findAll).toHaveBeenCalledWith(
      "t1",
      "cat-1",
      { limit: 20, offset: 0 },
      undefined,
    );
  });

  it("findAll passes undefined categoryId/options when omitted", () => {
    ctrl.findAll(req as any);
    expect(svc.findAll).toHaveBeenCalledWith(
      "t1",
      undefined,
      { limit: undefined, offset: undefined },
      undefined,
    );
  });

  it("findAll coerces the isAvailable query string to a boolean", () => {
    ctrl.findAll(req as any, undefined, "true");
    expect(svc.findAll).toHaveBeenCalledWith(
      "t1",
      undefined,
      { limit: undefined, offset: undefined },
      true,
    );

    (svc.findAll as jest.Mock).mockClear();
    ctrl.findAll(req as any, undefined, "false");
    expect(svc.findAll).toHaveBeenCalledWith(
      "t1",
      undefined,
      { limit: undefined, offset: undefined },
      false,
    );
  });

  it("findOne forwards id + tenantId", () => {
    ctrl.findOne("p1", req as any);
    expect(svc.findOne).toHaveBeenCalledWith("p1", "t1");
  });

  it("update forwards id, dto, tenantId", () => {
    const dto = { price: 9.99 } as any;
    ctrl.update("p1", dto, req as any);
    expect(svc.update).toHaveBeenCalledWith("p1", dto, "t1");
  });

  it("remove forwards id + tenantId", () => {
    ctrl.remove("p1", req as any);
    expect(svc.remove).toHaveBeenCalledWith("p1", "t1");
  });

  it("updateStock forwards id, quantity (from @Body) and tenantId", () => {
    ctrl.updateStock("p1", 7, req as any);
    expect(svc.updateStock).toHaveBeenCalledWith("p1", 7, "t1");
  });

  it("getProductImages forwards id + tenantId", () => {
    ctrl.getProductImages("p1", req as any);
    expect(svc.getProductImages).toHaveBeenCalledWith("p1", "t1");
  });

  it("reorderImages forwards id, imageIds (from @Body), tenantId", () => {
    ctrl.reorderImages("p1", ["i2", "i1"], req as any);
    expect(svc.reorderProductImages).toHaveBeenCalledWith(
      "p1",
      ["i2", "i1"],
      "t1",
    );
  });

  it("removeImage forwards both path params + tenantId", () => {
    ctrl.removeImage("p1", "img-9", req as any);
    expect(svc.removeImageFromProduct).toHaveBeenCalledWith(
      "p1",
      "img-9",
      "t1",
    );
  });
});

import { Product3dService } from "./product-3d.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

jest.mock("axios");
import axios from "axios";

jest.mock("fs", () => {
  const actual = jest.requireActual("fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
    },
  };
});

describe("Product3dService", () => {
  let prisma: MockPrismaClient;
  let config: { get: jest.Mock };
  let svc: Product3dService;
  const TENANT = "t1";

  const makeConfig = (over: Record<string, string> = {}) => ({
    get: jest.fn(
      (k: string) => ({ BACKEND_URL: "https://api.test", ...over })[k],
    ),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = mockPrismaClient();
    config = makeConfig();
    svc = new Product3dService(prisma as any, config as any);
    (prisma.product.update as any).mockImplementation(
      async ({ data }: any) => ({
        id: "p1",
        ...data,
      }),
    );
  });

  describe("gate", () => {
    it("is not configured and requestModel throws without a key or simulator", async () => {
      expect(svc.isConfigured()).toBe(false);
      await expect(svc.requestModel("p1", TENANT)).rejects.toThrow(
        /not configured/i,
      );
    });
    it("is configured with an API key", () => {
      svc = new Product3dService(
        prisma as any,
        makeConfig({ MESHY_API_KEY: "k" }) as any,
      );
      expect(svc.isConfigured()).toBe(true);
    });
    it("is configured in simulator mode", () => {
      svc = new Product3dService(
        prisma as any,
        makeConfig({ MESHY_SIMULATOR: "true" }) as any,
      );
      expect(svc.isConfigured()).toBe(true);
    });
  });

  describe("requestModel", () => {
    beforeEach(() => {
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        image: "/uploads/products/dish.jpg",
        model3dStatus: null,
        productImages: [],
      });
    });

    it("throws NotFound for a product outside the tenant", async () => {
      svc = new Product3dService(
        prisma as any,
        makeConfig({ MESHY_API_KEY: "k" }) as any,
      );
      (prisma.product.findFirst as any).mockResolvedValue(null);
      await expect(svc.requestModel("p1", TENANT)).rejects.toThrow(
        /not found/i,
      );
    });

    it("requires a dish photo", async () => {
      svc = new Product3dService(
        prisma as any,
        makeConfig({ MESHY_API_KEY: "k" }) as any,
      );
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        image: null,
        productImages: [],
        model3dStatus: null,
      });
      await expect(svc.requestModel("p1", TENANT)).rejects.toThrow(/no photo/i);
    });

    it("simulator marks the product READY with sample models (no API call)", async () => {
      svc = new Product3dService(
        prisma as any,
        makeConfig({ MESHY_SIMULATOR: "true" }) as any,
      );
      const out = await svc.requestModel("p1", TENANT);
      expect(axios.post).not.toHaveBeenCalled();
      expect(out.status).toBe("READY");
      expect(out.glbUrl).toMatch(/\.glb$/);
      expect(out.usdzUrl).toMatch(/\.usdz$/);
    });

    it("real mode POSTs a Meshy task (with absolute image url) and flips to PENDING", async () => {
      svc = new Product3dService(
        prisma as any,
        makeConfig({ MESHY_API_KEY: "k" }) as any,
      );
      (axios.post as any).mockResolvedValue({ data: { result: "task-123" } });
      const out = await svc.requestModel("p1", TENANT);
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/image-to-3d"),
        expect.objectContaining({
          image_url: "https://api.test/uploads/products/dish.jpg",
          target_formats: ["glb", "usdz"],
        }),
        expect.objectContaining({
          headers: { Authorization: "Bearer k" },
        }),
      );
      expect(out.status).toBe("PENDING");
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            model3dStatus: "PENDING",
            model3dTaskId: "task-123",
          }),
        }),
      );
    });

    it("does not re-request a product already PENDING", async () => {
      svc = new Product3dService(
        prisma as any,
        makeConfig({ MESHY_API_KEY: "k" }) as any,
      );
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        image: "/x.jpg",
        productImages: [],
        model3dStatus: "PENDING",
      });
      const out = await svc.requestModel("p1", TENANT);
      expect(axios.post).not.toHaveBeenCalled();
      expect(out.status).toBe("PENDING");
    });
  });

  describe("pollPendingModels → SUCCEEDED downloads + re-hosts", () => {
    it("downloads GLB+USDZ and marks READY with local URLs", async () => {
      svc = new Product3dService(
        prisma as any,
        makeConfig({ MESHY_API_KEY: "k" }) as any,
      );
      (prisma.product.findMany as any).mockResolvedValue([
        { id: "p1", model3dTaskId: "task-123" },
      ]);
      (axios.get as any).mockImplementation(async (url: string, opts: any) => {
        if (opts?.responseType === "arraybuffer")
          return { data: Buffer.from("model") };
        return {
          data: {
            status: "SUCCEEDED",
            model_urls: {
              glb: "https://assets.meshy.ai/x.glb?Expires=1",
              usdz: "https://assets.meshy.ai/x.usdz?Expires=1",
            },
          },
        };
      });

      await svc.pollPendingModels();

      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "p1" },
          data: expect.objectContaining({
            model3dStatus: "READY",
            model3dUrl: "https://api.test/uploads/models/p1.glb",
            model3dUsdzUrl: "https://api.test/uploads/models/p1.usdz",
          }),
        }),
      );
    });

    it("marks FAILED when Meshy reports the task failed", async () => {
      svc = new Product3dService(
        prisma as any,
        makeConfig({ MESHY_API_KEY: "k" }) as any,
      );
      (prisma.product.findMany as any).mockResolvedValue([
        { id: "p1", model3dTaskId: "task-123" },
      ]);
      (axios.get as any).mockResolvedValue({
        data: { status: "FAILED", task_error: { message: "bad image" } },
      });

      await svc.pollPendingModels();

      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            model3dStatus: "FAILED",
            model3dError: "bad image",
          }),
        }),
      );
    });

    it("is a no-op with no API key (simulator finishes inline)", async () => {
      await svc.pollPendingModels();
      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });
  });

  describe("getStatus (read-only)", () => {
    it("returns the stored state without triggering generation", async () => {
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        model3dStatus: "READY",
        model3dUrl: "u.glb",
        model3dUsdzUrl: "u.usdz",
        model3dError: null,
      });
      const out = await svc.getStatus("p1", TENANT);
      expect(out).toEqual({
        productId: "p1",
        status: "READY",
        glbUrl: "u.glb",
        usdzUrl: "u.usdz",
        error: null,
      });
      expect(axios.post).not.toHaveBeenCalled();
    });
  });
});

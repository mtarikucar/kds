import { ProductMediaService } from "./product-media.service";
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
      stat: jest.fn().mockResolvedValue({ size: 1234 }),
    },
  };
});

describe("ProductMediaService", () => {
  let prisma: MockPrismaClient;
  let svc: ProductMediaService;
  const TENANT = "t1";

  const cfg = (over: Record<string, string> = {}) => ({
    get: jest.fn(
      (k: string) => ({ BACKEND_URL: "https://api.test", ...over })[k],
    ),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = mockPrismaClient();
    (prisma as any).$transaction = jest.fn(async (cb: any) => cb(prisma));
    let seq = 0;
    (prisma.productMediaJob.create as any).mockImplementation(
      async ({ data }: any) => ({ id: `job${++seq}`, ...data }),
    );
    (prisma.productMediaJob.update as any).mockImplementation(
      async ({ where, data }: any) => ({ id: where.id, ...data }),
    );
    (prisma.productMediaJob.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.productMediaJob.findUnique as any).mockResolvedValue({
      id: "job1",
      kind: "PHOTO",
      status: "COMPLETED",
      resultUrls: ["https://api.test/uploads/media/x.png"],
    });
    (prisma.productImage.create as any).mockResolvedValue({ id: "img1" });
    (prisma.productToImage.count as any).mockResolvedValue(0);
    (prisma.productToImage.create as any).mockResolvedValue({});
    (prisma.product.update as any).mockImplementation(
      async ({ data }: any) => ({
        id: "p1",
        ...data,
      }),
    );
    (prisma.product.findUnique as any).mockResolvedValue({
      name: "Adana",
      image: null,
    });
  });

  const make = (over: Record<string, string> = {}) =>
    new ProductMediaService(prisma as any, cfg(over) as any);

  describe("gate", () => {
    it("throws when not configured", async () => {
      svc = make();
      expect(svc.isConfigured()).toBe(false);
      (prisma.product.findFirst as any).mockResolvedValue({ id: "p1" });
      await expect(svc.generatePhoto("p1", TENANT)).rejects.toThrow(
        /not configured/i,
      );
    });
    it("configured with a key / simulator", () => {
      expect(make({ FAL_KEY: "k" }).isConfigured()).toBe(true);
      expect(make({ FAL_SIMULATOR: "true" }).isConfigured()).toBe(true);
    });
  });

  describe("generatePhoto", () => {
    beforeEach(() => {
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        name: "Adana",
        description: "acılı",
        ingredients: "dana kıyma",
      });
      (axios.get as any).mockResolvedValue({ data: Buffer.from("img") });
    });

    it("submits a queue job (real key) and returns IN_QUEUE", async () => {
      svc = make({ FAL_KEY: "k" });
      (axios.post as any).mockResolvedValue({ data: { request_id: "req-1" } });
      const out = await svc.generatePhoto("p1", TENANT, { count: 2 });
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("queue.fal.run/fal-ai/flux/dev"),
        expect.objectContaining({ num_images: 2 }),
        expect.objectContaining({ headers: { Authorization: "Key k" } }),
      );
      expect(out.status).toBe("IN_QUEUE");
      expect(out.kind).toBe("PHOTO");
    });

    it("uses the operator prompt when given", async () => {
      svc = make({ FAL_KEY: "k" });
      (axios.post as any).mockResolvedValue({ data: { request_id: "req-1" } });
      await svc.generatePhoto("p1", TENANT, { prompt: "koyu arka plan" });
      expect((axios.post as any).mock.calls[0][1].prompt).toContain(
        "koyu arka plan",
      );
    });

    it("simulator finishes inline (COMPLETED) + adds to library", async () => {
      svc = make({ FAL_SIMULATOR: "true" });
      const out = await svc.generatePhoto("p1", TENANT);
      expect(axios.post).not.toHaveBeenCalled();
      expect(prisma.productImage.create).toHaveBeenCalled();
      expect(out.status).toBe("COMPLETED");
    });
  });

  describe("generateIngredientsFrame", () => {
    it("requires ingredients", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        ingredients: "",
      });
      await expect(svc.generateIngredientsFrame("p1", TENANT)).rejects.toThrow(
        /ingredients/i,
      );
    });

    it("submits a FRAME queue job", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        name: "Adana",
        ingredients: "dana kıyma, soğan",
      });
      (axios.post as any).mockResolvedValue({ data: { request_id: "req-2" } });
      const out = await svc.generateIngredientsFrame("p1", TENANT);
      expect(out.kind).toBe("FRAME");
      expect(out.status).toBe("IN_QUEUE");
    });
  });

  describe("generateIngredientsVideo", () => {
    const product = {
      id: "p1",
      image: "/uploads/products/dish.jpg",
      ingredients: "dana kıyma",
      ingredientsImageUrl: "https://api.test/uploads/media/frame.png",
      productImages: [],
    };

    it("requires a dish photo", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.product.findFirst as any).mockResolvedValue({
        ...product,
        image: null,
      });
      await expect(svc.generateIngredientsVideo("p1", TENANT)).rejects.toThrow(
        /dish photo/i,
      );
    });

    it("requires the last frame first", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.product.findFirst as any).mockResolvedValue({
        ...product,
        ingredientsImageUrl: null,
      });
      await expect(svc.generateIngredientsVideo("p1", TENANT)).rejects.toThrow(
        /last frame/i,
      );
    });

    it("submits a VIDEO queue job from the reviewed frame", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.product.findFirst as any).mockResolvedValue(product);
      (axios.post as any).mockResolvedValue({ data: { request_id: "req-3" } });
      const out = await svc.generateIngredientsVideo("p1", TENANT, {
        prompt: "yavaş geçiş",
      });
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("queue.fal.run/"),
        expect.objectContaining({
          start_image_url: "https://api.test/uploads/products/dish.jpg",
          end_image_url: "https://api.test/uploads/media/frame.png",
          prompt: "yavaş geçiş",
        }),
        expect.anything(),
      );
      expect(out.kind).toBe("VIDEO");
    });
  });

  describe("setPrimaryImage", () => {
    it("sets product.image + reorders the link to 0", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.product.findFirst as any).mockResolvedValue({ id: "p1" });
      (prisma.productImage.findFirst as any).mockResolvedValue({
        id: "img5",
        url: "https://api.test/uploads/media/pick.png",
      });
      (prisma.productToImage.findFirst as any).mockResolvedValue({ id: "l1" });
      (prisma.productToImage.findMany as any).mockResolvedValue([]);
      (prisma.productToImage.updateMany as any).mockResolvedValue({});
      const out = await svc.setPrimaryImage("p1", TENANT, "img5");
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { image: "https://api.test/uploads/media/pick.png" },
        }),
      );
      expect(out.imageUrl).toContain("pick.png");
    });
  });

  describe("pollPendingJobs", () => {
    it("no-op without a key", async () => {
      svc = make({ FAL_SIMULATOR: "true" });
      await svc.pollPendingJobs();
      expect(prisma.productMediaJob.findMany).not.toHaveBeenCalled();
    });

    it("COMPLETED image job → downloads candidates + finalizes", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.productMediaJob.findMany as any).mockResolvedValue([
        {
          id: "job1",
          productId: "p1",
          tenantId: "t1",
          kind: "PHOTO",
          status: "IN_PROGRESS",
          falRequestId: "req-1",
          attempts: 0,
        },
      ]);
      (axios.get as any).mockImplementation(async (url: string, opts: any) => {
        if (opts?.responseType === "arraybuffer")
          return { data: Buffer.from("img") };
        if (url.includes("/status"))
          return {
            data: { status: "COMPLETED", logs: [{ message: "20/28" }] },
          };
        return { data: { images: [{ url: "https://fal/a.png" }] } };
      });
      await svc.pollPendingJobs();
      expect(prisma.productImage.create).toHaveBeenCalled();
      expect(prisma.productMediaJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "COMPLETED" }),
        }),
      );
    });

    it("IN_PROGRESS → records parsed percent", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.productMediaJob.findMany as any).mockResolvedValue([
        {
          id: "job2",
          productId: "p1",
          tenantId: "t1",
          kind: "PHOTO",
          status: "IN_QUEUE",
          falRequestId: "req-9",
          attempts: 0,
        },
      ]);
      (axios.get as any).mockResolvedValue({
        data: { status: "IN_PROGRESS", logs: [{ message: "step 14/28" }] },
      });
      await svc.pollPendingJobs();
      expect(prisma.productMediaJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "IN_PROGRESS", percent: 50 }),
        }),
      );
    });

    it("claim guard: skips finalize when already claimed (count 0)", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.productMediaJob.findMany as any).mockResolvedValue([
        {
          id: "job1",
          productId: "p1",
          tenantId: "t1",
          kind: "PHOTO",
          status: "IN_PROGRESS",
          falRequestId: "req-1",
          attempts: 0,
        },
      ]);
      (prisma.productMediaJob.updateMany as any).mockResolvedValue({
        count: 0,
      });
      (axios.get as any).mockResolvedValue({
        data: { status: "COMPLETED", logs: [] },
      });
      await svc.pollPendingJobs();
      expect(prisma.productImage.create).not.toHaveBeenCalled();
    });

    it("COMPLETED but download fails → increments attempts, not finalized", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.productMediaJob.findMany as any).mockResolvedValue([
        {
          id: "job1",
          productId: "p1",
          tenantId: "t1",
          kind: "PHOTO",
          status: "IN_PROGRESS",
          falRequestId: "req-1",
          attempts: 0,
        },
      ]);
      (axios.get as any).mockImplementation(async (url: string) => {
        if (url.includes("/status"))
          return { data: { status: "COMPLETED", logs: [] } };
        throw new Error("fal 403"); // result fetch fails persistently
      });
      await svc.pollPendingJobs();
      expect(prisma.productImage.create).not.toHaveBeenCalled();
      expect(prisma.productMediaJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "IN_PROGRESS", attempts: 1 }),
        }),
      );
    });
  });

  describe("getStatus", () => {
    it("returns committed media + jobs", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        image: "https://api.test/img.png",
        videoUrl: null,
        videoStatus: null,
        videoError: null,
        ingredientsImageUrl: null,
      });
      (prisma.productMediaJob.findMany as any).mockResolvedValue([
        { id: "j1", kind: "PHOTO", status: "COMPLETED", resultUrls: ["u"] },
      ]);
      const out = await svc.getStatus("p1", TENANT);
      expect(out.imageUrl).toBe("https://api.test/img.png");
      expect(out.jobs).toHaveLength(1);
      expect(out.jobs[0].kind).toBe("PHOTO");
    });
  });
});

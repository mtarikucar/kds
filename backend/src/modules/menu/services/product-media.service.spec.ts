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
    (prisma.product.update as any).mockImplementation(
      async ({ data }: any) => ({
        id: "p1",
        ...data,
      }),
    );
  });

  const make = (over: Record<string, string> = {}) =>
    new ProductMediaService(prisma as any, cfg(over) as any);

  describe("gate", () => {
    it("throws when neither FAL_KEY nor simulator is set", async () => {
      svc = make();
      expect(svc.isConfigured()).toBe(false);
      await expect(svc.generatePhoto("p1", TENANT)).rejects.toThrow(
        /not configured/i,
      );
    });
    it("configured with a key", () => {
      expect(make({ FAL_KEY: "k" }).isConfigured()).toBe(true);
    });
    it("configured in simulator", () => {
      expect(make({ FAL_SIMULATOR: "true" }).isConfigured()).toBe(true);
    });
  });

  describe("generatePhoto", () => {
    beforeEach(() => {
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        name: "Adana",
        description: "acılı",
      });
    });

    it("calls fal text-to-image, downloads, and sets product.image", async () => {
      svc = make({ FAL_KEY: "k" });
      (axios.post as any).mockResolvedValue({
        data: { images: [{ url: "https://fal.media/x.png" }] },
      });
      (axios.get as any).mockResolvedValue({ data: Buffer.from("img") });

      const out = await svc.generatePhoto("p1", TENANT);

      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("fal.run/fal-ai/flux/dev"),
        expect.objectContaining({ prompt: expect.stringContaining("Adana") }),
        expect.objectContaining({ headers: { Authorization: "Key k" } }),
      );
      expect(out.imageUrl).toBe("https://api.test/uploads/media/p1-photo.png");
    });

    it("simulator sets a sample photo without calling fal", async () => {
      svc = make({ FAL_SIMULATOR: "true" });
      (axios.get as any).mockResolvedValue({ data: Buffer.from("img") });
      const out = await svc.generatePhoto("p1", TENANT);
      expect(axios.post).not.toHaveBeenCalled();
      expect(out.imageUrl).toContain("/uploads/media/p1-photo.png");
    });
  });

  describe("generateIngredientsVideo", () => {
    const product = {
      id: "p1",
      image: "/uploads/products/dish.jpg",
      ingredients: "dana kıyma, soğan",
      productImages: [],
      videoStatus: null,
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

    it("requires ingredients", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.product.findFirst as any).mockResolvedValue({
        ...product,
        ingredients: "",
      });
      await expect(svc.generateIngredientsVideo("p1", TENANT)).rejects.toThrow(
        /ingredients/i,
      );
    });

    it("generates the ingredients still then submits a dual-keyframe video → PENDING", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.product.findFirst as any).mockResolvedValue(product);
      // 1st axios.post = fal image (sync); 2nd = fal video queue submit.
      (axios.post as any)
        .mockResolvedValueOnce({
          data: { images: [{ url: "https://fal/ing.png" }] },
        })
        .mockResolvedValueOnce({ data: { request_id: "req-9" } });
      (axios.get as any).mockResolvedValue({ data: Buffer.from("img") });

      const out = await svc.generateIngredientsVideo("p1", TENANT);

      // The video submit carries start (dish, absolute) + end (ingredients) frames.
      expect(axios.post).toHaveBeenLastCalledWith(
        expect.stringContaining("queue.fal.run/"),
        expect.objectContaining({
          start_image_url: "https://api.test/uploads/products/dish.jpg",
          end_image_url: "https://api.test/uploads/media/p1-ingredients.png",
        }),
        expect.objectContaining({ headers: { Authorization: "Key k" } }),
      );
      expect(out.videoStatus).toBe("PENDING");
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            videoStatus: "PENDING",
            videoTaskId: "req-9",
          }),
        }),
      );
    });

    it("simulator marks READY with a sample video inline", async () => {
      svc = make({ FAL_SIMULATOR: "true" });
      (prisma.product.findFirst as any).mockResolvedValue(product);
      (axios.get as any).mockResolvedValue({ data: Buffer.from("img") });
      const out = await svc.generateIngredientsVideo("p1", TENANT);
      expect(axios.post).not.toHaveBeenCalled();
      expect(out.videoStatus).toBe("READY");
      expect(out.videoUrl).toBeTruthy();
    });

    it("does not re-submit a video already PENDING", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.product.findFirst as any).mockResolvedValue({
        ...product,
        videoStatus: "PENDING",
      });
      const out = await svc.generateIngredientsVideo("p1", TENANT);
      expect(axios.post).not.toHaveBeenCalled();
      expect(out.videoStatus).toBe("PENDING");
    });
  });

  describe("pollPendingVideos", () => {
    it("COMPLETED → downloads the video and marks READY", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.product.findMany as any).mockResolvedValue([
        { id: "p1", videoTaskId: "req-9" },
      ]);
      (axios.get as any).mockImplementation(async (url: string, opts: any) => {
        if (opts?.responseType === "arraybuffer")
          return { data: Buffer.from("video") };
        if (url.endsWith("/status")) return { data: { status: "COMPLETED" } };
        return { data: { video: { url: "https://fal.media/v.mp4" } } };
      });

      await svc.pollPendingVideos();

      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "p1" },
          data: expect.objectContaining({
            videoStatus: "READY",
            videoUrl: "https://api.test/uploads/media/p1.mp4",
          }),
        }),
      );
    });

    it("is a no-op without a key", async () => {
      svc = make({ FAL_SIMULATOR: "true" });
      await svc.pollPendingVideos();
      expect(prisma.product.findMany).not.toHaveBeenCalled();
    });
  });
});

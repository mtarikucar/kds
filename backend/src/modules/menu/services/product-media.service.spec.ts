import { ProductMediaService } from "./product-media.service";
import {
  mockPrismaClient,
  MockPrismaClient,
} from "../../../common/test/prisma-mock.service";

jest.mock("axios");
import axios from "axios";

jest.mock("sharp", () => {
  const chain = {
    resize: jest.fn().mockReturnThis(),
    composite: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from("composited")),
  };
  return jest.fn(() => chain);
});

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
        ingredients: "dana kıyma, soğan",
      });
      (prisma as any).$transaction = jest.fn(async (cb: any) => cb(prisma));
      (prisma.productImage.create as any).mockResolvedValue({
        id: "img1",
        url: "https://api.test/uploads/media/p1-photo-1.png",
      });
      (prisma.productToImage.count as any).mockResolvedValue(0);
      (prisma.productToImage.create as any).mockResolvedValue({});
    });

    it("generates the photo, adds it to the library, and links it", async () => {
      svc = make({ FAL_KEY: "k" });
      (axios.post as any).mockResolvedValue({
        data: { images: [{ url: "https://fal.media/x.png" }] },
      });
      (axios.get as any).mockResolvedValue({ data: Buffer.from("img") });

      const out = await svc.generatePhoto("p1", TENANT);

      // Prompt reflects name + ingredients.
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("fal.run/fal-ai/flux/dev"),
        expect.objectContaining({
          prompt: expect.stringContaining("Adana"),
        }),
        expect.objectContaining({ headers: { Authorization: "Key k" } }),
      );
      expect((axios.post as any).mock.calls[0][1].prompt).toContain(
        "dana kıyma",
      );
      // Added to the ProductImage library + linked to the product.
      expect(prisma.productImage.create).toHaveBeenCalled();
      expect(prisma.productToImage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ productId: "p1", imageId: "img1" }),
        }),
      );
      expect(out.imageUrl).toContain("/uploads/media/p1-photo-");
      expect(out.image).toEqual(expect.objectContaining({ id: "img1" }));
    });

    it("simulator generates a sample photo without calling fal", async () => {
      svc = make({ FAL_SIMULATOR: "true" });
      (axios.get as any).mockResolvedValue({ data: Buffer.from("img") });
      const out = await svc.generatePhoto("p1", TENANT);
      expect(axios.post).not.toHaveBeenCalled();
      expect(prisma.productImage.create).toHaveBeenCalled();
      expect(out.imageUrl).toContain("/uploads/media/p1-photo-");
    });
  });

  describe("generateIngredientsFrame (step 1 — the last frame)", () => {
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

    it("generates the labelled still and stores it as the end frame", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        ingredients: "dana kıyma, soğan",
      });
      (axios.post as any).mockResolvedValue({
        data: { images: [{ url: "https://fal/ing.png" }] },
      });
      (axios.get as any).mockResolvedValue({ data: Buffer.from("img") });

      const out = await svc.generateIngredientsFrame("p1", TENANT);

      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("fal.run/fal-ai/flux/dev"),
        expect.objectContaining({
          prompt: expect.stringContaining("dana kıyma"),
        }),
        expect.anything(),
      );
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ingredientsImageUrl: expect.stringContaining(
              "/uploads/media/p1-ingredients-",
            ),
          }),
        }),
      );
      expect(out.ingredientsImageUrl).toContain(
        "/uploads/media/p1-ingredients-",
      );
    });

    it("simulator sets a sample frame without calling fal", async () => {
      svc = make({ FAL_SIMULATOR: "true" });
      (prisma.product.findFirst as any).mockResolvedValue({
        id: "p1",
        ingredients: "x",
      });
      (axios.get as any).mockResolvedValue({ data: Buffer.from("img") });
      const out = await svc.generateIngredientsFrame("p1", TENANT);
      expect(axios.post).not.toHaveBeenCalled();
      expect(out.ingredientsImageUrl).toBeTruthy();
    });
  });

  describe("generateIngredientsVideo (step 2 — the video)", () => {
    const product = {
      id: "p1",
      image: "/uploads/products/dish.jpg",
      ingredients: "dana kıyma, soğan",
      ingredientsImageUrl: "https://api.test/uploads/media/p1-ingredients.png",
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

    it("requires the last frame to be generated first", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.product.findFirst as any).mockResolvedValue({
        ...product,
        ingredientsImageUrl: null,
      });
      await expect(svc.generateIngredientsVideo("p1", TENANT)).rejects.toThrow(
        /last frame/i,
      );
    });

    it("submits a dual-keyframe video from the reviewed frame → PENDING", async () => {
      svc = make({ FAL_KEY: "k" });
      (prisma.product.findFirst as any).mockResolvedValue(product);
      (axios.post as any).mockResolvedValue({ data: { request_id: "req-9" } });

      const out = await svc.generateIngredientsVideo("p1", TENANT);

      expect(axios.post).toHaveBeenCalledWith(
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
            videoUrl: "https://api.test/uploads/media/p1-req-9.mp4",
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

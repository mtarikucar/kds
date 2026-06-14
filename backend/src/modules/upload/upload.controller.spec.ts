import { BadRequestException } from "@nestjs/common";
import { UploadController } from "./upload.controller";
import { UploadService } from "./upload.service";

/**
 * Long-tail spec for the upload controller. Load-bearing contracts: a
 * missing file (multer passed nothing through the filter) → 400 rather than
 * an NPE downstream; every call is tenant-scoped via req.tenantId; and the
 * multi-upload response wraps the images with a count.
 */
describe("UploadController", () => {
  let svc: Record<string, jest.Mock>;
  let ctrl: UploadController;
  const req = { tenantId: "t1" };
  const file = { mimetype: "image/png" } as Express.Multer.File;

  beforeEach(() => {
    svc = {
      uploadLogo: jest.fn().mockResolvedValue({ url: "/logo.png" }),
      uploadProductImage: jest.fn().mockResolvedValue({ url: "/p.png" }),
      uploadMultipleProductImages: jest
        .fn()
        .mockResolvedValue([{ url: "/a.png" }, { url: "/b.png" }]),
      deleteProductImage: jest.fn().mockResolvedValue(undefined),
      getProductImages: jest.fn().mockResolvedValue([]),
      getUnusedImages: jest.fn().mockResolvedValue([]),
    };
    ctrl = new UploadController(svc as unknown as UploadService);
  });

  it("uploadLogo throws 400 when no file is present", async () => {
    await expect(
      ctrl.uploadLogo(undefined as unknown as Express.Multer.File, req),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("uploadLogo forwards the file + tenantId", async () => {
    await ctrl.uploadLogo(file, req);
    expect(svc.uploadLogo).toHaveBeenCalledWith(file, "t1");
  });

  it("uploadMultipleImages throws 400 on an empty file list", async () => {
    await expect(ctrl.uploadMultipleImages([], req)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("uploadMultipleImages wraps images with a count", async () => {
    const out = await ctrl.uploadMultipleImages([file, file], req);
    expect(out.count).toBe(2);
    expect(out.images).toHaveLength(2);
  });

  it("deleteImage is tenant-scoped and returns a message", async () => {
    const out = await ctrl.deleteImage("img-1", req);
    expect(svc.deleteProductImage).toHaveBeenCalledWith("img-1", "t1");
    expect(out).toEqual({ message: "Image deleted successfully" });
  });

  it("getProductImages forwards the optional productId filter", async () => {
    await ctrl.getProductImages(req, "prod-1");
    expect(svc.getProductImages).toHaveBeenCalledWith("t1", "prod-1");
  });
});

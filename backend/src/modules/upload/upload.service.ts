import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import sharp from "sharp";
import * as fs from "fs/promises";
import * as path from "path";
import { PrismaService } from "../../prisma/prisma.service";
import { randomUUID } from "crypto";

const ALLOWED_IMAGE_FORMATS = new Set(["jpeg", "png", "webp"]);

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly uploadsDir: string;
  private readonly uploadsRoot: string;
  private readonly baseUrl: string;
  private readonly maxFileSize = 5 * 1024 * 1024; // 5MB
  private readonly allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.uploadsRoot = path.resolve(process.cwd(), "uploads");
    this.uploadsDir = path.join(this.uploadsRoot, "products");
    this.baseUrl =
      this.configService.get("BACKEND_URL") ||
      this.configService.get("FRONTEND_URL") ||
      "http://localhost:3000";
    this.ensureUploadDir();
    this.ensureLogosDir();
  }

  /**
   * Magic-byte sniff using sharp.metadata(). Trusting only the client-supplied
   * Content-Type header lets a `.svg` (XSS via <script>) or `.php` sail past
   * an ALLOWED_MIME check — sharp throws / returns wrong format on non-image
   * bytes. We also reject SVG explicitly since it's an XSS vector even when
   * correctly formatted.
   */
  private async assertIsAllowedImage(buffer: Buffer): Promise<void> {
    let metadata;
    try {
      metadata = await sharp(buffer, { failOn: "error" }).metadata();
    } catch {
      throw new BadRequestException("Invalid image file");
    }
    const format = metadata.format?.toLowerCase();
    if (!format || !ALLOWED_IMAGE_FORMATS.has(format)) {
      throw new BadRequestException(
        "Invalid file type. Only JPEG, PNG, and WebP are allowed",
      );
    }
  }

  private async ensureUploadDir() {
    try {
      await fs.access(this.uploadsDir);
    } catch {
      await fs.mkdir(this.uploadsDir, { recursive: true });
      this.logger.log(`Created uploads directory: ${this.uploadsDir}`);
    }
  }

  private async ensureLogosDir() {
    const logosDir = path.join(process.cwd(), "uploads", "logos");
    try {
      await fs.access(logosDir);
    } catch {
      await fs.mkdir(logosDir, { recursive: true });
      this.logger.log(`Created logos directory: ${logosDir}`);
    }
  }

  async uploadLogo(
    file: Express.Multer.File,
    tenantId: string,
  ): Promise<{ url: string }> {
    // Validate file
    if (!file) {
      throw new BadRequestException("No file provided");
    }

    if (file.size > this.maxFileSize) {
      throw new BadRequestException("File size exceeds 5MB limit");
    }

    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        "Invalid file type. Only JPEG, PNG, and WebP are allowed",
      );
    }
    await this.assertIsAllowedImage(file.buffer);

    const uniqueFilename = `${tenantId}-logo-${Date.now()}.png`;
    const logosDir = path.join(process.cwd(), "uploads", "logos");
    const filePath = path.join(logosDir, uniqueFilename);
    const relativePath = path.join("uploads", "logos", uniqueFilename);

    try {
      // Optimize and save image using Sharp - resize for logo
      const optimizedBuffer = await sharp(file.buffer)
        .resize(512, 512, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .png({ quality: 90 })
        .toBuffer();

      await fs.writeFile(filePath, optimizedBuffer);

      // Sweep prior logo files for this tenant. Each upload writes a
      // new `${tenantId}-logo-${Date.now()}.png`; without this prune
      // step the previous logos sit on disk forever and the volume
      // grows monotonically — at one logo per tenant per week, a
      // 1000-tenant deployment hoards ~50k orphan files a year.
      // Filter by the well-known prefix so we never touch another
      // tenant's logo, and skip the file we just wrote.
      await this.pruneTenantLogos(logosDir, tenantId, uniqueFilename);

      // Return the URL
      const absoluteUrl = `${this.baseUrl}/${relativePath.replace(/\\/g, "/")}`;

      this.logger.log(`Uploaded logo ${uniqueFilename} for tenant ${tenantId}`);

      return { url: absoluteUrl };
    } catch (error) {
      this.logger.error(`Failed to upload logo: ${error.message}`);
      throw new BadRequestException("Failed to upload logo");
    }
  }

  /**
   * Remove prior `${tenantId}-logo-*.png` files from `logosDir`,
   * leaving `keepFilename` (the file we just wrote) intact. Failures
   * to delete individual files are logged but never raised — disk
   * cleanup is best-effort and must not fail the upload.
   */
  private async pruneTenantLogos(
    logosDir: string,
    tenantId: string,
    keepFilename: string,
  ): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(logosDir);
    } catch {
      return; // dir disappeared — nothing to prune
    }
    const prefix = `${tenantId}-logo-`;
    await Promise.all(
      entries
        .filter((name) => name.startsWith(prefix) && name !== keepFilename)
        .map(async (name) => {
          try {
            await fs.unlink(path.join(logosDir, name));
          } catch (err: any) {
            this.logger.warn(
              `Failed to prune old logo ${name}: ${err?.message ?? err}`,
            );
          }
        }),
    );
  }

  async uploadProductImage(
    file: Express.Multer.File,
    tenantId: string,
  ): Promise<any> {
    // Validate file
    if (!file) {
      throw new BadRequestException("No file provided");
    }

    if (file.size > this.maxFileSize) {
      throw new BadRequestException("File size exceeds 5MB limit");
    }

    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        "Invalid file type. Only JPEG, PNG, and WebP are allowed",
      );
    }
    await this.assertIsAllowedImage(file.buffer);

    // Ignore client-supplied file extension to dodge path-traversal via
    // crafted filenames; sharp re-encodes to JPEG below so the .jpg suffix
    // matches the on-disk bytes.
    const fileExtension = ".jpg";
    const uniqueFilename = `${randomUUID()}${fileExtension}`;
    const tenantDir = path.join(this.uploadsDir, tenantId);

    // Ensure tenant directory exists
    try {
      await fs.access(tenantDir);
    } catch {
      await fs.mkdir(tenantDir, { recursive: true });
    }

    const filePath = path.join(tenantDir, uniqueFilename);
    const relativePath = path.join(
      "uploads",
      "products",
      tenantId,
      uniqueFilename,
    );

    try {
      // Optimize and save image using Sharp
      const optimizedBuffer = await sharp(file.buffer)
        .resize(1200, 1200, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();

      await fs.writeFile(filePath, optimizedBuffer);

      // Save to database with absolute URL
      const absoluteUrl = `${this.baseUrl}/${relativePath}`;
      const productImage = await this.prisma.productImage.create({
        data: {
          url: absoluteUrl,
          filename: file.originalname,
          size: optimizedBuffer.length,
          mimeType: file.mimetype,
          tenantId,
        },
      });

      this.logger.log(
        `Uploaded image ${uniqueFilename} for tenant ${tenantId}`,
      );

      return productImage;
    } catch (error) {
      this.logger.error(`Failed to upload image: ${error.message}`);
      // Clean up file if database save fails
      try {
        await fs.unlink(filePath);
      } catch {}
      throw new BadRequestException("Failed to upload image");
    }
  }

  async uploadMultipleProductImages(
    files: Express.Multer.File[],
    tenantId: string,
  ): Promise<any[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException("No files provided");
    }

    const uploadPromises = files.map((file) =>
      this.uploadProductImage(file, tenantId),
    );

    return Promise.all(uploadPromises);
  }

  async deleteProductImage(imageId: string, tenantId: string): Promise<void> {
    const image = await this.prisma.productImage.findFirst({
      where: {
        id: imageId,
        tenantId,
      },
    });

    if (!image) {
      throw new NotFoundException("Image not found");
    }

    // Extract relative path from absolute URL and contain within uploadsRoot.
    // Defense-in-depth: today the url is always constructed server-side, but
    // a future import path or DB migration could introduce untrusted URLs.
    const urlPath = image.url.replace(this.baseUrl, "");
    const resolvedPath = path.resolve(
      process.cwd(),
      urlPath.replace(/^\/+/, ""),
    );
    if (!resolvedPath.startsWith(this.uploadsRoot + path.sep)) {
      this.logger.warn(
        `Refusing to delete path outside uploads root: ${resolvedPath}`,
      );
    } else {
      try {
        await fs.unlink(resolvedPath);
      } catch (error) {
        this.logger.warn(
          `Failed to delete file ${resolvedPath}: ${error.message}`,
        );
      }
    }

    // Defence-in-depth: tenantId in the WHERE (B41-B45 pattern).
    await this.prisma.productImage.deleteMany({
      where: { id: imageId, tenantId },
    });

    this.logger.log(`Deleted image ${imageId} for tenant ${tenantId}`);
  }

  // 500 covers any realistic admin gallery in one round-trip while
  // bounding the payload + DB scan cost. A tenant with 10k+ images
  // (would be unusual) should paginate via a future limit/offset
  // parameter rather than expecting an unbounded dump here.
  private static readonly LIST_HARD_CAP = 500;

  async getProductImages(tenantId: string, productId?: string): Promise<any[]> {
    if (productId) {
      // Get images for specific product via junction table — bounded by
      // the per-product image cap (already small in practice; the take
      // here is defence-in-depth).
      const productToImages = await this.prisma.productToImage.findMany({
        where: {
          productId,
          image: {
            tenantId,
          },
        },
        include: {
          image: true,
        },
        orderBy: { order: "asc" },
        take: UploadService.LIST_HARD_CAP,
      });
      return productToImages.map((pti) => ({ ...pti.image, order: pti.order }));
    }

    // Get all images for tenant — previously unbounded; an admin who
    // had bulk-uploaded thousands of images saw the whole set in one
    // payload, blowing memory + JSON parse time on the client.
    return this.prisma.productImage.findMany({
      where: {
        tenantId,
      },
      orderBy: { createdAt: "desc" },
      take: UploadService.LIST_HARD_CAP,
    });
  }

  async getUnusedImages(tenantId: string): Promise<any[]> {
    // Get images that are not linked to any product in junction table.
    // The `notIn: usedIds` array was previously unbounded — a tenant
    // with N images and M product-attachments paid M IDs across the
    // wire on every call. Cap the candidate set so the IN-list stays
    // sane.
    const usedImageIds = await this.prisma.productToImage.findMany({
      where: {
        image: {
          tenantId,
        },
      },
      select: {
        imageId: true,
      },
    });

    const usedIds = usedImageIds.map((pti) => pti.imageId);

    return this.prisma.productImage.findMany({
      where: {
        tenantId,
        id: {
          notIn: usedIds,
        },
      },
      orderBy: { createdAt: "desc" },
      take: UploadService.LIST_HARD_CAP,
    });
  }

  async attachImageToProduct(
    imageId: string,
    productId: string,
    order: number,
    tenantId: string,
  ): Promise<any> {
    const image = await this.prisma.productImage.findFirst({
      where: {
        id: imageId,
        tenantId,
      },
    });

    if (!image) {
      throw new NotFoundException("Image not found");
    }

    // Cross-tenant attachment guard: without this, a tenant with a
    // valid image of their own could attach it to ANOTHER tenant's
    // product just by guessing the productId. The junction-table FKs
    // are tenant-agnostic so the DB happily accepts the link.
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }

    // Create or update link in junction table
    return this.prisma.productToImage.upsert({
      where: {
        productId_imageId: {
          productId,
          imageId,
        },
      },
      update: {
        order,
      },
      create: {
        productId,
        imageId,
        order,
      },
    });
  }
}

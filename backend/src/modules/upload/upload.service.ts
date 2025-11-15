import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { randomUUID } from 'crypto';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private readonly uploadsDir: string;
  private readonly baseUrl: string;
  private readonly maxFileSize = 5 * 1024 * 1024; // 5MB
  private readonly allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.uploadsDir = path.join(process.cwd(), 'uploads', 'products');
    // Get base URL from environment or construct from FRONTEND_URL
    this.baseUrl = this.configService.get('BACKEND_URL') ||
                   this.configService.get('FRONTEND_URL') ||
                   'http://localhost:3000';
    this.ensureUploadDir();
  }

  private async ensureUploadDir() {
    try {
      await fs.access(this.uploadsDir);
    } catch {
      await fs.mkdir(this.uploadsDir, { recursive: true });
      this.logger.log(`Created uploads directory: ${this.uploadsDir}`);
    }
  }

  async uploadProductImage(
    file: Express.Multer.File,
    tenantId: string,
  ): Promise<any> {
    // Validate file
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (file.size > this.maxFileSize) {
      throw new BadRequestException('File size exceeds 5MB limit');
    }

    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Invalid file type. Only JPEG, PNG, and WebP are allowed',
      );
    }

    // Generate unique filename
    const fileExtension = path.extname(file.originalname);
    const uniqueFilename = `${randomUUID()}${fileExtension}`;
    const tenantDir = path.join(this.uploadsDir, tenantId);

    // Ensure tenant directory exists
    try {
      await fs.access(tenantDir);
    } catch {
      await fs.mkdir(tenantDir, { recursive: true });
    }

    const filePath = path.join(tenantDir, uniqueFilename);
    const relativePath = path.join('uploads', 'products', tenantId, uniqueFilename);

    try {
      // Optimize and save image using Sharp
      const optimizedBuffer = await sharp(file.buffer)
        .resize(1200, 1200, {
          fit: 'inside',
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
      throw new BadRequestException('Failed to upload image');
    }
  }

  async uploadMultipleProductImages(
    files: Express.Multer.File[],
    tenantId: string,
  ): Promise<any[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
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
      throw new NotFoundException('Image not found');
    }

    // Delete file from filesystem
    // Extract relative path from absolute URL
    const urlPath = image.url.replace(this.baseUrl, '');
    const filePath = path.join(process.cwd(), urlPath);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      this.logger.warn(`Failed to delete file ${filePath}: ${error.message}`);
    }

    // Delete from database
    await this.prisma.productImage.delete({
      where: { id: imageId },
    });

    this.logger.log(`Deleted image ${imageId} for tenant ${tenantId}`);
  }

  async getProductImages(tenantId: string, productId?: string): Promise<any[]> {
    if (productId) {
      // Get images for specific product via junction table
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
        orderBy: { order: 'asc' },
      });
      return productToImages.map(pti => ({ ...pti.image, order: pti.order }));
    }

    // Get all images for tenant
    return this.prisma.productImage.findMany({
      where: {
        tenantId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUnusedImages(tenantId: string): Promise<any[]> {
    // Get images that are not linked to any product in junction table
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

    const usedIds = usedImageIds.map(pti => pti.imageId);

    return this.prisma.productImage.findMany({
      where: {
        tenantId,
        id: {
          notIn: usedIds,
        },
      },
      orderBy: { createdAt: 'desc' },
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
      throw new NotFoundException('Image not found');
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

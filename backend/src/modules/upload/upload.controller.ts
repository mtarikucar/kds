import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles.enum';
import { UploadService } from './upload.service';
import { UploadResponseDto, MultipleUploadResponseDto } from './dto/upload-response.dto';

@ApiTags('upload')
@ApiBearerAuth()
@Controller('upload')
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('product-image')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @UseInterceptors(FileInterceptor('image'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload single product image' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Image uploaded successfully',
    type: UploadResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid file or file too large' })
  async uploadSingleImage(
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ): Promise<UploadResponseDto> {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const tenantId = req.tenantId;
    return this.uploadService.uploadProductImage(file, tenantId);
  }

  @Post('product-images')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @UseInterceptors(FilesInterceptor('images', 10)) // Max 10 images at once
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload multiple product images' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        images: {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Images uploaded successfully',
    type: MultipleUploadResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid files or files too large' })
  async uploadMultipleImages(
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req,
  ): Promise<MultipleUploadResponseDto> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files uploaded');
    }

    const tenantId = req.tenantId;
    const images = await this.uploadService.uploadMultipleProductImages(
      files,
      tenantId,
    );

    return {
      images,
      count: images.length,
    };
  }

  @Delete('product-image/:id')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Delete product image' })
  @ApiResponse({ status: 200, description: 'Image deleted successfully' })
  @ApiResponse({ status: 404, description: 'Image not found' })
  async deleteImage(
    @Param('id') imageId: string,
    @Request() req,
  ): Promise<{ message: string }> {
    const tenantId = req.tenantId;
    await this.uploadService.deleteProductImage(imageId, tenantId);

    return { message: 'Image deleted successfully' };
  }

  @Get('product-images')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get all product images for tenant' })
  @ApiResponse({
    status: 200,
    description: 'List of product images',
    type: [UploadResponseDto],
  })
  async getProductImages(
    @Request() req,
    @Query('productId') productId?: string,
  ): Promise<UploadResponseDto[]> {
    const tenantId = req.tenantId;
    return this.uploadService.getProductImages(tenantId, productId);
  }

  @Get('product-images/unused')
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @ApiOperation({ summary: 'Get unused product images (not attached to any product)' })
  @ApiResponse({
    status: 200,
    description: 'List of unused images',
    type: [UploadResponseDto],
  })
  async getUnusedImages(@Request() req): Promise<UploadResponseDto[]> {
    const tenantId = req.tenantId;
    return this.uploadService.getUnusedImages(tenantId);
  }
}

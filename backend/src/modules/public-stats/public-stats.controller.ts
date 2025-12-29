import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  Ip,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { PublicStatsService } from './public-stats.service';
import { TrackViewDto } from './dto/track-view.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { PublicStatsResponseDto, PublicReviewResponseDto } from './dto/public-stats-response.dto';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('public-stats')
@Controller('public-stats')
export class PublicStatsController {
  constructor(private readonly statsService: PublicStatsService) {}

  @Public()
  @Post('track')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Track page view (Public)' })
  @ApiResponse({ status: 200, description: 'View tracked successfully' })
  async trackView(
    @Body() dto: TrackViewDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    // Fire and forget - don't block response
    this.statsService.trackPageView(dto, ip, userAgent || '').catch(() => {});
    return { success: true };
  }

  @Public()
  @Get('stats')
  @ApiOperation({ summary: 'Get public statistics (Public)' })
  @ApiResponse({ status: 200, description: 'Public statistics', type: PublicStatsResponseDto })
  async getStats(): Promise<PublicStatsResponseDto> {
    return this.statsService.getPublicStats();
  }

  @Public()
  @Post('reviews')
  @ApiOperation({ summary: 'Submit a review (Public)' })
  @ApiResponse({ status: 201, description: 'Review submitted successfully' })
  async submitReview(
    @Body() dto: CreateReviewDto,
    @Ip() ip: string,
  ) {
    const review = await this.statsService.submitReview(dto, ip);
    return {
      success: true,
      message: 'Review submitted successfully. It will be published after approval.',
      reviewId: review.id,
    };
  }

  @Public()
  @Get('reviews')
  @ApiOperation({ summary: 'Get approved reviews (Public)' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of approved reviews', type: [PublicReviewResponseDto] })
  async getReviews(
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
  ): Promise<PublicReviewResponseDto[]> {
    return this.statsService.getApprovedReviews(Math.min(limit, 50));
  }

  // Admin endpoints for review moderation
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('admin/reviews/pending')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get pending reviews (Admin only)' })
  async getPendingReviews() {
    return this.statsService.getPendingReviews();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('admin/reviews/:id/approve')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a review (Admin only)' })
  async approveReview(@Param('id') id: string) {
    return this.statsService.approveReview(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('admin/reviews/:id/reject')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject a review (Admin only)' })
  async rejectReview(@Param('id') id: string) {
    return this.statsService.rejectReview(id);
  }
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PublicStatsResponseDto {
  @ApiProperty({ description: 'Total page views' })
  totalViews: number;

  @ApiProperty({ description: 'Unique visitors count' })
  uniqueVisitors: number;

  @ApiProperty({ description: 'Total approved reviews' })
  totalReviews: number;

  @ApiProperty({ description: 'Average rating (1-5)' })
  averageRating: number;

  @ApiProperty({ description: 'Total active restaurants' })
  totalTenants: number;

  @ApiPropertyOptional({ description: 'Country distribution', type: 'object' })
  countryDistribution?: Record<string, number>;

  @ApiPropertyOptional({ description: 'City distribution', type: 'object' })
  cityDistribution?: Record<string, number>;

  @ApiProperty({ description: 'Views today' })
  viewsToday: number;

  @ApiProperty({ description: 'Views this week' })
  viewsThisWeek: number;

  @ApiProperty({ description: 'Views this month' })
  viewsThisMonth: number;

  @ApiProperty({ description: 'Last updated timestamp' })
  lastUpdated: Date;
}

export class PublicReviewResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  restaurant?: string;

  @ApiProperty()
  rating: number;

  @ApiProperty()
  comment: string;

  @ApiPropertyOptional()
  avatar?: string;

  @ApiProperty()
  isVerified: boolean;

  @ApiProperty()
  createdAt: Date;
}

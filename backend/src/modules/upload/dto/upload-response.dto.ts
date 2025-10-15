import { ApiProperty } from '@nestjs/swagger';

export class UploadResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  url: string;

  @ApiProperty()
  filename: string;

  @ApiProperty()
  size: number;

  @ApiProperty()
  mimeType: string;

  @ApiProperty()
  tenantId: string;
}

export class MultipleUploadResponseDto {
  @ApiProperty({ type: [UploadResponseDto] })
  images: UploadResponseDto[];

  @ApiProperty()
  count: number;
}

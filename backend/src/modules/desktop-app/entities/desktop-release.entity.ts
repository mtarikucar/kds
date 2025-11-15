import { ApiProperty } from '@nestjs/swagger';

export class DesktopRelease {
  @ApiProperty()
  id: string;

  @ApiProperty({ example: '0.2.6' })
  version: string;

  @ApiProperty({ example: 'v0.2.6' })
  releaseTag: string;

  @ApiProperty()
  published: boolean;

  @ApiProperty()
  pubDate: Date;

  @ApiProperty({ required: false })
  windowsUrl?: string;

  @ApiProperty({ required: false })
  windowsSignature?: string;

  @ApiProperty({ required: false })
  macArmUrl?: string;

  @ApiProperty({ required: false })
  macArmSignature?: string;

  @ApiProperty({ required: false })
  macIntelUrl?: string;

  @ApiProperty({ required: false })
  macIntelSignature?: string;

  @ApiProperty({ required: false })
  linuxUrl?: string;

  @ApiProperty({ required: false })
  linuxSignature?: string;

  @ApiProperty()
  releaseNotes: string;

  @ApiProperty({ required: false })
  changelog?: string;

  @ApiProperty()
  downloadCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

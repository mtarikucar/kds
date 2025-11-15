import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsBoolean, IsOptional, IsInt, Min } from 'class-validator';

export class CreateReleaseDto {
  @ApiProperty({ example: '0.2.6', description: 'Semantic version number (synced with web app)' })
  @IsString()
  version: string;

  @ApiProperty({ example: 'v0.2.6', description: 'Git release tag' })
  @IsString()
  releaseTag: string;

  @ApiProperty({ example: '## What\'s New\n- Feature X\n- Bug fix Y', description: 'Release notes in markdown format' })
  @IsString()
  releaseNotes: string;

  @ApiProperty({ required: false, description: 'Detailed changelog in markdown' })
  @IsOptional()
  @IsString()
  changelog?: string;

  @ApiProperty({ required: false, default: false, description: 'Whether the release is published' })
  @IsOptional()
  @IsBoolean()
  published?: boolean;

  // Platform URLs
  @ApiProperty({ required: false, description: 'Windows installer URL (GitHub Release)' })
  @IsOptional()
  @IsString()
  windowsUrl?: string;

  @ApiProperty({ required: false, description: 'Windows installer signature' })
  @IsOptional()
  @IsString()
  windowsSignature?: string;

  @ApiProperty({ required: false, description: 'macOS ARM installer URL' })
  @IsOptional()
  @IsString()
  macArmUrl?: string;

  @ApiProperty({ required: false, description: 'macOS ARM installer signature' })
  @IsOptional()
  @IsString()
  macArmSignature?: string;

  @ApiProperty({ required: false, description: 'macOS Intel installer URL' })
  @IsOptional()
  @IsString()
  macIntelUrl?: string;

  @ApiProperty({ required: false, description: 'macOS Intel installer signature' })
  @IsOptional()
  @IsString()
  macIntelSignature?: string;

  @ApiProperty({ required: false, description: 'Linux installer URL' })
  @IsOptional()
  @IsString()
  linuxUrl?: string;

  @ApiProperty({ required: false, description: 'Linux installer signature' })
  @IsOptional()
  @IsString()
  linuxSignature?: string;
}

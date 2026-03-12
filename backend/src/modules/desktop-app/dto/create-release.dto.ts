import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsBoolean, IsOptional, IsNotEmpty, IsUrl, Matches } from 'class-validator';

export class CreateReleaseDto {
  @ApiProperty({ example: '0.2.6', description: 'Semantic version number (synced with web app)' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+\.\d+\.\d+$/, { message: 'version must be a valid semver format (e.g. 1.2.3)' })
  version: string;

  @ApiProperty({ example: 'v0.2.6', description: 'Git release tag' })
  @IsString()
  @IsNotEmpty()
  releaseTag: string;

  @ApiProperty({ example: '## What\'s New\n- Feature X\n- Bug fix Y', description: 'Release notes in markdown format' })
  @IsString()
  @IsNotEmpty()
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
  @IsUrl()
  windowsUrl?: string;

  @ApiProperty({ required: false, description: 'Windows installer signature' })
  @IsOptional()
  @IsString()
  windowsSignature?: string;

  @ApiProperty({ required: false, description: 'macOS ARM installer URL' })
  @IsOptional()
  @IsUrl()
  macArmUrl?: string;

  @ApiProperty({ required: false, description: 'macOS ARM installer signature' })
  @IsOptional()
  @IsString()
  macArmSignature?: string;

  @ApiProperty({ required: false, description: 'macOS Intel installer URL' })
  @IsOptional()
  @IsUrl()
  macIntelUrl?: string;

  @ApiProperty({ required: false, description: 'macOS Intel installer signature' })
  @IsOptional()
  @IsString()
  macIntelSignature?: string;

  @ApiProperty({ required: false, description: 'Linux installer URL' })
  @IsOptional()
  @IsUrl()
  linuxUrl?: string;

  @ApiProperty({ required: false, description: 'Linux installer signature' })
  @IsOptional()
  @IsString()
  linuxSignature?: string;
}

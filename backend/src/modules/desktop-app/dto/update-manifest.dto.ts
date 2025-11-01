import { ApiProperty } from '@nestjs/swagger';

export class PlatformManifest {
  @ApiProperty({ description: 'Download URL for the platform' })
  url: string;

  @ApiProperty({ description: 'Signature for update verification' })
  signature: string;
}

export class UpdateManifestDto {
  @ApiProperty({ example: '0.2.7', description: 'Latest version available' })
  version: string;

  @ApiProperty({ example: '## What\'s New\n- Feature X', description: 'Release notes in markdown' })
  notes: string;

  @ApiProperty({ example: '2024-11-01T15:00:00Z', description: 'Publication date in ISO format' })
  pub_date: string;

  @ApiProperty({
    description: 'Platform-specific download information',
    type: 'object',
    properties: {
      'windows-x86_64': { $ref: '#/components/schemas/PlatformManifest' },
      'darwin-aarch64': { $ref: '#/components/schemas/PlatformManifest' },
      'darwin-x86_64': { $ref: '#/components/schemas/PlatformManifest' },
      'linux-x86_64': { $ref: '#/components/schemas/PlatformManifest' },
    }
  })
  platforms: {
    'windows-x86_64'?: PlatformManifest;
    'darwin-aarch64'?: PlatformManifest;
    'darwin-x86_64'?: PlatformManifest;
    'linux-x86_64'?: PlatformManifest;
  };
}

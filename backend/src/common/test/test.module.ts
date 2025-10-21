import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

/**
 * Test module for unit and integration tests
 * Provides common test dependencies
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env.test',
      ignoreEnvFile: true, // Use in-memory config for tests
    }),
  ],
  providers: [],
  exports: [],
})
export class TestModule {}

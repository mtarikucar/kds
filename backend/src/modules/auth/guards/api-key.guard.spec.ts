import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard } from './api-key.guard';

/**
 * Spec for the service-to-service ApiKeyGuard. Unlike JwtAuthGuard it never
 * honors @Public; once attached it always enforces the key. Covers: missing
 * key, unconfigured server secret, mismatch (timing-safe), and the happy path.
 * Also asserts both header aliases (x-api-key / api-key) are accepted.
 */
function ctxWithHeaders(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}
function configWith(secret?: string) {
  return { get: () => secret } as any;
}

describe('ApiKeyGuard', () => {
  const reflector = new Reflector();

  it('throws when no API key header is present', () => {
    const guard = new ApiKeyGuard(reflector, configWith('the-secret'));
    expect(() => guard.canActivate(ctxWithHeaders({}))).toThrow(UnauthorizedException);
  });

  it('throws when the server secret is not configured', () => {
    const guard = new ApiKeyGuard(reflector, configWith(undefined));
    expect(() => guard.canActivate(ctxWithHeaders({ 'x-api-key': 'whatever' }))).toThrow(
      /not configured/i,
    );
  });

  it('throws on a key mismatch', () => {
    const guard = new ApiKeyGuard(reflector, configWith('the-secret'));
    expect(() => guard.canActivate(ctxWithHeaders({ 'x-api-key': 'wrong' }))).toThrow(
      /Invalid API key/i,
    );
  });

  it('accepts a matching key via x-api-key', () => {
    const guard = new ApiKeyGuard(reflector, configWith('the-secret'));
    expect(guard.canActivate(ctxWithHeaders({ 'x-api-key': 'the-secret' }))).toBe(true);
  });

  it('accepts a matching key via the api-key alias', () => {
    const guard = new ApiKeyGuard(reflector, configWith('the-secret'));
    expect(guard.canActivate(ctxWithHeaders({ 'api-key': 'the-secret' }))).toBe(true);
  });

  it('rejects a key of different length (timing-safe length guard)', () => {
    const guard = new ApiKeyGuard(reflector, configWith('the-secret'));
    expect(() => guard.canActivate(ctxWithHeaders({ 'x-api-key': 'short' }))).toThrow(
      /Invalid API key/i,
    );
  });
});

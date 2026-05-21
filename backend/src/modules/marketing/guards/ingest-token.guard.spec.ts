import { ConfigService } from '@nestjs/config';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { IngestTokenGuard } from './ingest-token.guard';

function makeContext(headers: Record<string, string>): ExecutionContext {
  const req = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any as ExecutionContext;
}

function makeGuard(expected: string | undefined): IngestTokenGuard {
  const config = {
    get: (key: string) =>
      key === 'MARKETING_INGEST_TOKEN' ? expected : undefined,
  } as ConfigService;
  return new IngestTokenGuard(config);
}

describe('IngestTokenGuard', () => {
  const TOKEN = 'a'.repeat(64);

  it('returns true when the x-ingest-token header matches', () => {
    const guard = makeGuard(TOKEN);
    expect(
      guard.canActivate(makeContext({ 'x-ingest-token': TOKEN })),
    ).toBe(true);
  });

  it('throws when the header is missing', () => {
    const guard = makeGuard(TOKEN);
    expect(() => guard.canActivate(makeContext({}))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(makeContext({}))).toThrow(/Missing/);
  });

  it('throws when the supplied token has the wrong length', () => {
    const guard = makeGuard(TOKEN);
    expect(() =>
      guard.canActivate(makeContext({ 'x-ingest-token': 'short' })),
    ).toThrow(UnauthorizedException);
  });

  it('throws when the supplied token has the right length but wrong value', () => {
    const guard = makeGuard(TOKEN);
    expect(() =>
      guard.canActivate(makeContext({ 'x-ingest-token': 'b'.repeat(64) })),
    ).toThrow(UnauthorizedException);
  });

  it('throws "Ingest disabled" when MARKETING_INGEST_TOKEN is empty', () => {
    const guard = makeGuard('');
    expect(() =>
      guard.canActivate(makeContext({ 'x-ingest-token': TOKEN })),
    ).toThrow(/Ingest disabled/);
  });

  it('throws "Ingest disabled" when MARKETING_INGEST_TOKEN is unset', () => {
    const guard = makeGuard(undefined);
    expect(() =>
      guard.canActivate(makeContext({ 'x-ingest-token': TOKEN })),
    ).toThrow(/Ingest disabled/);
  });
});

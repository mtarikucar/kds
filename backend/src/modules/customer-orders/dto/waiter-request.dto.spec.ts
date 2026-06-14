import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateBillRequestDto,
  CreateWaiterRequestDto,
} from './waiter-request.dto';

/**
 * Validation specs for the @Public waiter/bill-request DTOs. The sessionId is
 * the security-relevant field: exactly 64 lower-hex chars (32 random bytes).
 * The tight regex stops malformed payloads at the boundary instead of wasting
 * a DB lookup. tableId optional uuid; message optional <=500.
 */
function collect(es: any[]): string[] {
  return es.flatMap((e) => [
    ...Object.values(e.constraints ?? {}),
    ...collect(e.children ?? []),
  ]) as string[];
}
async function validateDto(cls: any, input: Record<string, unknown>): Promise<string[]> {
  return collect(await validate(plainToInstance(cls, input) as object));
}

const SESSION = 'a'.repeat(64); // 64 lower-hex chars

describe('CreateWaiterRequestDto', () => {
  it('accepts a valid request with hex session + message', async () => {
    expect(
      await validateDto(CreateWaiterRequestDto, {
        sessionId: SESSION,
        message: 'We need extra plates',
      }),
    ).toEqual([]);
  });

  it('rejects a session that is not 64 chars (Length)', async () => {
    const msgs = await validateDto(CreateWaiterRequestDto, { sessionId: 'a'.repeat(32) });
    expect(msgs.some((m) => /sessionId/i.test(m))).toBe(true);
  });

  it('rejects a session with non-hex chars (Matches regex)', async () => {
    const msgs = await validateDto(CreateWaiterRequestDto, { sessionId: 'Z'.repeat(64) });
    expect(msgs.some((m) => /sessionId/i.test(m))).toBe(true);
  });

  it('rejects a non-uuid tableId', async () => {
    const msgs = await validateDto(CreateWaiterRequestDto, {
      sessionId: SESSION,
      tableId: 'x',
    });
    expect(msgs.some((m) => /tableId/i.test(m))).toBe(true);
  });

  it('rejects a message over 500 chars', async () => {
    const msgs = await validateDto(CreateWaiterRequestDto, {
      sessionId: SESSION,
      message: 'x'.repeat(501),
    });
    expect(msgs.some((m) => /message/i.test(m))).toBe(true);
  });
});

describe('CreateBillRequestDto', () => {
  it('accepts a valid bill request', async () => {
    expect(await validateDto(CreateBillRequestDto, { sessionId: SESSION })).toEqual([]);
  });

  it('rejects a malformed session', async () => {
    const msgs = await validateDto(CreateBillRequestDto, { sessionId: 'short' });
    expect(msgs.some((m) => /sessionId/i.test(m))).toBe(true);
  });
});

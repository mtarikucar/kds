import { NetgsmLiteAdapter } from './netgsm-lite.adapter';

describe('NetgsmLiteAdapter', () => {
  let registry: { register: jest.Mock };
  let config: { get: jest.Mock };
  let adapter: NetgsmLiteAdapter;

  beforeEach(() => {
    registry = { register: jest.fn() };
    config = { get: jest.fn().mockReturnValue(undefined) };
    adapter = new NetgsmLiteAdapter(registry as any, config as any);
  });

  it('is a single-line click-to-dial provider', () => {
    expect(adapter.id).toBe('netgsm-lite');
    expect(adapter.maxConcurrentCalls).toBe(1);
    expect(adapter.capabilities).toContain('click-to-dial');
    expect(adapter.capabilities).toContain('manual-log');
  });

  it('self-registers with the registry on module init', () => {
    adapter.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(adapter);
  });

  it('prepares a tel: dial URI from a Turkish mobile, with no upstream call', async () => {
    const prepared = await adapter.prepareOutboundCall({
      toPhone: '0555 123 45 67',
      marketingUserId: 'rep-1',
    });
    expect(prepared).toEqual({
      providerId: 'netgsm-lite',
      dialUri: 'tel:+905551234567',
      mode: 'click-to-dial',
      externalCallId: null,
    });
  });

  it('keeps an explicit +country number as-is', async () => {
    const p = await adapter.prepareOutboundCall({
      toPhone: '+49 30 1234567',
      marketingUserId: 'r',
    });
    expect(p.dialUri).toBe('tel:+49301234567');
  });

  it('healthCheck reports click-to-dial readiness', async () => {
    const h = await adapter.healthCheck();
    expect(h.ok).toBe(true);
    expect(h.details).toMatchObject({ mode: 'click-to-dial' });
  });
});

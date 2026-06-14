import { EntitlementInvalidationBus } from './entitlement-invalidation.bus';

/**
 * Spec for the cross-replica invalidation bus, driving the message-handling
 * logic WITHOUT a real Redis connection (pub/sub are null until onModuleInit
 * wires them). Covers:
 *  - publish() is a safe no-op when Redis is unavailable
 *  - the private onMessage dispatch: valid peer message → listener fires;
 *    self-echo (matching senderId) → ignored; malformed/empty → ignored
 */
describe('EntitlementInvalidationBus (message handling)', () => {
  let bus: EntitlementInvalidationBus;
  let received: string[];

  beforeEach(() => {
    bus = new EntitlementInvalidationBus();
    received = [];
    bus.registerListener((tenantId) => received.push(tenantId));
  });

  // helper to reach the private onMessage + senderId
  const onMessage = (raw: string) => (bus as any).onMessage(raw);
  const ownSenderId = () => (bus as any).senderId as string;

  it('publish() resolves without throwing when Redis is not connected', async () => {
    await expect(bus.publish('t1')).resolves.toBeUndefined();
    expect(received).toEqual([]);
  });

  it('invokes the local listener for a valid peer message', () => {
    onMessage(JSON.stringify({ tenantId: 't1', senderId: 'peer-pod' }));
    expect(received).toEqual(['t1']);
  });

  it('ignores an echo of our own publish (matching senderId)', () => {
    onMessage(JSON.stringify({ tenantId: 't1', senderId: ownSenderId() }));
    expect(received).toEqual([]);
  });

  it('ignores a message with no tenantId', () => {
    onMessage(JSON.stringify({ senderId: 'peer-pod' }));
    expect(received).toEqual([]);
  });

  it('ignores malformed JSON without throwing', () => {
    expect(() => onMessage('not-json{')).not.toThrow();
    expect(received).toEqual([]);
  });

  it('does not throw when no listener is registered', () => {
    const fresh = new EntitlementInvalidationBus();
    expect(() =>
      (fresh as any).onMessage(JSON.stringify({ tenantId: 't1', senderId: 'peer' })),
    ).not.toThrow();
  });
});

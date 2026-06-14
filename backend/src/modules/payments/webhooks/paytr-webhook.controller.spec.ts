import { PaytrWebhookController } from './paytr-webhook.controller';
import { computeCallbackHash } from './paytr-hash.util';

/**
 * Spec for the PayTR webhook controller — the security/dispatch boundary:
 *  - missing creds → "FAIL" (no settlement)
 *  - bad hash → "FAIL" (no settlement)
 *  - valid hash dispatches by merchant_oid prefix: SP→self-pay, CK-→checkout,
 *    default→subscription settlement
 *  - success vs failure branch within each
 *  - CK- settlement errors are swallowed (still returns "OK")
 */
const KEY = 'merchant-key';
const SALT = 'merchant-salt';

function makeConfig(creds: { key?: string | undefined; salt?: string | undefined } = {}) {
  const map: Record<string, string | undefined> = {
    PAYTR_MERCHANT_KEY: 'key' in creds ? creds.key : KEY,
    PAYTR_MERCHANT_SALT: 'salt' in creds ? creds.salt : SALT,
  };
  return { get: (k: string) => map[k] } as any;
}

function signedBody(over: Record<string, string>): Record<string, string> {
  const merchantOid = over.merchant_oid ?? 'OID1';
  const status = over.status ?? 'success';
  const totalAmount = over.total_amount ?? '1000';
  const hash = computeCallbackHash({
    merchantOid,
    merchantSalt: SALT,
    status,
    totalAmount,
    merchantKey: KEY,
  });
  return { merchant_oid: merchantOid, status, total_amount: totalAmount, hash, ...over };
}

describe('PaytrWebhookController', () => {
  let selfPay: Record<string, jest.Mock>;
  let settlement: Record<string, jest.Mock>;
  let checkoutSettlement: Record<string, jest.Mock>;

  function make(config = makeConfig()) {
    selfPay = {
      handleWebhookSuccess: jest.fn().mockResolvedValue(undefined),
      handleWebhookFailure: jest.fn().mockResolvedValue(undefined),
    };
    settlement = { settlePayment: jest.fn().mockResolvedValue(undefined) };
    checkoutSettlement = {
      handleSuccess: jest.fn().mockResolvedValue(undefined),
      handleFailure: jest.fn().mockResolvedValue(undefined),
    };
    return new PaytrWebhookController(
      config,
      selfPay as any,
      settlement as any,
      checkoutSettlement as any,
    );
  }

  it('returns FAIL and does not settle when merchant creds are missing', async () => {
    const ctrl = make(makeConfig({ key: undefined, salt: undefined }));
    const res = await ctrl.handle(signedBody({ merchant_oid: 'OID1' }));
    expect(res).toBe('FAIL');
    expect(settlement.settlePayment).not.toHaveBeenCalled();
  });

  it('returns FAIL on a bad hash', async () => {
    const ctrl = make();
    const res = await ctrl.handle({
      merchant_oid: 'OID1',
      status: 'success',
      total_amount: '1000',
      hash: 'definitely-wrong',
    });
    expect(res).toBe('FAIL');
    expect(settlement.settlePayment).not.toHaveBeenCalled();
  });

  it('dispatches an SP success to self-pay and returns OK', async () => {
    const ctrl = make();
    const res = await ctrl.handle(
      signedBody({ merchant_oid: 'SP123', status: 'success', payment_type: 'card' }),
    );
    expect(res).toBe('OK');
    expect(selfPay.handleWebhookSuccess).toHaveBeenCalledWith('SP123', 'card');
    expect(selfPay.handleWebhookFailure).not.toHaveBeenCalled();
  });

  it('dispatches an SP failure with the failure message', async () => {
    const ctrl = make();
    await ctrl.handle(
      signedBody({ merchant_oid: 'SP123', status: 'failed', failed_reason_msg: 'declined' }),
    );
    expect(selfPay.handleWebhookFailure).toHaveBeenCalledWith('SP123', 'declined');
  });

  it('dispatches a CK- success to checkout settlement', async () => {
    const ctrl = make();
    const res = await ctrl.handle(
      signedBody({ merchant_oid: 'CK-9', status: 'success', payment_type: 'card' }),
    );
    expect(res).toBe('OK');
    expect(checkoutSettlement.handleSuccess).toHaveBeenCalledWith('CK-9', 'card');
  });

  it('swallows a CK- settlement error but still returns OK', async () => {
    const ctrl = make();
    checkoutSettlement.handleSuccess.mockRejectedValueOnce(new Error('provision blew up'));
    const res = await ctrl.handle(signedBody({ merchant_oid: 'CK-9', status: 'success' }));
    expect(res).toBe('OK');
  });

  it('routes a default (subscription) success to settlePayment with success payload', async () => {
    const ctrl = make();
    const res = await ctrl.handle(
      signedBody({ merchant_oid: 'SUB1', status: 'success', payment_type: 'card', total_amount: '4990' }),
    );
    expect(res).toBe('OK');
    expect(settlement.settlePayment).toHaveBeenCalledWith('SUB1', {
      kind: 'success',
      paymentType: 'card',
      totalAmount: '4990',
    });
  });

  it('routes a default failure to settlePayment with failure payload', async () => {
    const ctrl = make();
    await ctrl.handle(
      signedBody({
        merchant_oid: 'SUB1',
        status: 'failed',
        failed_reason_code: '10',
        failed_reason_msg: 'insufficient funds',
      }),
    );
    expect(settlement.settlePayment).toHaveBeenCalledWith('SUB1', {
      kind: 'failure',
      failureCode: '10',
      failureMessage: 'insufficient funds',
    });
  });
});

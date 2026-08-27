import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import i18n from '../i18n/config';
import {
  asApiError,
  getApiErrorCode,
  getApiErrorMessage,
  getApiErrorStatus,
  type ApiErrorBody,
} from './api-error';

/** Build a realistic AxiosError carrying the NestJS HttpException body. */
function axiosErrorWith(body: ApiErrorBody, status = 400): AxiosError {
  const headers = new AxiosHeaders();
  const config = { headers } as never;
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, {}, {
    data: body,
    status,
    statusText: 'Bad Request',
    headers,
    config,
  } as never);
}

describe('asApiError', () => {
  it('passes axios errors through', () => {
    const err = axiosErrorWith({ message: 'nope' });
    expect(asApiError(err)).toBe(err);
  });

  it('returns null for plain errors, strings, and undefined', () => {
    expect(asApiError(new Error('boom'))).toBeNull();
    expect(asApiError('boom')).toBeNull();
    expect(asApiError(undefined)).toBeNull();
  });
});

describe('getApiErrorMessage', () => {
  it('returns the string message from the response body', () => {
    const err = axiosErrorWith({ message: 'Table already occupied' });
    expect(getApiErrorMessage(err, 'fallback')).toBe('Table already occupied');
  });

  it('joins class-validator message arrays', () => {
    const err = axiosErrorWith({
      message: ['name must be a string', 'price must be positive'],
    });
    expect(getApiErrorMessage(err, 'fallback')).toBe(
      'name must be a string; price must be positive',
    );
  });

  it('falls back when the body has no usable message', () => {
    expect(getApiErrorMessage(axiosErrorWith({}), 'fallback')).toBe('fallback');
    expect(getApiErrorMessage(axiosErrorWith({ message: '' }), 'fallback')).toBe(
      'fallback',
    );
    expect(getApiErrorMessage(axiosErrorWith({ message: [] }), 'fallback')).toBe(
      'fallback',
    );
  });

  it('falls back for non-axios errors', () => {
    expect(getApiErrorMessage(new Error('boom'), 'fallback')).toBe('fallback');
  });

  it('localizes a known errorCode over the backend English message', () => {
    // The backend hardcodes English messages; when it also sends a known
    // errorCode we show the locale-appropriate string instead (fixes the
    // "Invalid email or password" toast staying English under tr/ar/ru/uz).
    const err = axiosErrorWith({
      errorCode: 'INVALID_CREDENTIALS',
      message: 'Invalid email or password',
    });
    const expected = i18n.t('errors:apiCodes.INVALID_CREDENTIALS', {
      defaultValue: '',
    });
    expect(expected).toBeTruthy();
    expect(getApiErrorMessage(err, 'fallback')).toBe(expected);
  });

  it('localizes DEMO_PAYMENT_BLOCKED for a blocked demo-tenant payment', () => {
    // Backend 403s any real-money initiation for the shared demo tenant with
    // this errorCode; the toast must show the friendly localized message,
    // not the raw backend text, on every payment surface (subscription
    // checkout, marketplace/hardware store, QR self-pay).
    const err = axiosErrorWith(
      { errorCode: 'DEMO_PAYMENT_BLOCKED', message: 'Demo payment blocked' },
      403,
    );
    const expected = i18n.t('errors:apiCodes.DEMO_PAYMENT_BLOCKED', {
      defaultValue: '',
    });
    expect(expected).toBeTruthy();
    expect(getApiErrorMessage(err, 'fallback')).toBe(expected);
  });

  it('localizes the QR geofence refusals instead of leaking Turkish to a guest', () => {
    // These two land on a diner's own phone, on a QR menu that may be running
    // in en/ru/uz/ar. getApiErrorMessage passes a 4xx `message` through
    // verbatim, so before the backend attached these codes the guest read the
    // backend's Turkish sentence whatever language they had picked.
    const cases: Array<[string, string]> = [
      [
        'LOCATION_REQUIRED',
        'Konum bilgisi gerekli. Lütfen tarayıcı konum iznini etkinleştirin.',
      ],
      [
        'LOCATION_OUT_OF_RANGE',
        'Sipariş vermek için restoran konumunda olmanız gerekiyor. Mevcut mesafe: 320m (maksimum: 100m)',
      ],
    ];
    for (const [errorCode, turkishPassthrough] of cases) {
      const err = axiosErrorWith({ errorCode, message: turkishPassthrough });
      const expected = i18n.t(`errors:apiCodes.${errorCode}`, {
        defaultValue: '',
      });
      expect(expected).toBeTruthy();
      const shown = getApiErrorMessage(err, 'fallback');
      expect(shown).toBe(expected);
      expect(shown).not.toBe(turkishPassthrough);
    }
  });

  it('never shows the raw 429 message to the user (ThrottlerException leak)', () => {
    // Nest's ThrottlerGuard answers with the literal body
    // { statusCode: 429, message: 'ThrottlerException: Too Many Requests' }
    // and attaches no errorCode. A QR-menu diner was shown that string.
    const err = axiosErrorWith(
      { statusCode: 429, message: 'ThrottlerException: Too Many Requests' },
      429,
    );
    const shown = getApiErrorMessage(err, 'fallback');
    expect(shown).not.toMatch(/Throttler/i);
    expect(shown).toBe(i18n.t('errors:apiCodes.TOO_MANY_REQUESTS'));
  });

  it('never shows raw 5xx internals to the user', () => {
    const err = axiosErrorWith(
      { statusCode: 500, message: 'connect ECONNREFUSED 10.0.0.4:5432' },
      500,
    );
    const shown = getApiErrorMessage(err, 'fallback');
    expect(shown).not.toMatch(/ECONNREFUSED/);
    expect(shown).toBe(i18n.t('errors:apiCodes.INTERNAL_SERVER_ERROR'));
  });

  it('maps 503 to the service-unavailable string', () => {
    const err = axiosErrorWith({ statusCode: 503, message: 'upstream down' }, 503);
    expect(getApiErrorMessage(err, 'fallback')).toBe(
      i18n.t('errors:apiCodes.SERVICE_UNAVAILABLE'),
    );
  });

  it('still shows 4xx validation messages, which ARE written for the user', () => {
    // The other direction: 400/403/409 messages are the domain refusals a
    // guest needs to read ("Table already occupied"), so they pass through.
    expect(
      getApiErrorMessage(axiosErrorWith({ message: 'Table already occupied' }, 409), 'fallback'),
    ).toBe('Table already occupied');
    expect(
      getApiErrorMessage(
        axiosErrorWith({ message: ['price must be positive'] }, 400),
        'fallback',
      ),
    ).toBe('price must be positive');
  });

  it('keeps the specific backend message for an unmapped errorCode', () => {
    const err = axiosErrorWith({
      errorCode: 'SOME_UNMAPPED_CODE',
      message: 'field-specific detail',
    });
    expect(getApiErrorMessage(err, 'fallback')).toBe('field-specific detail');
  });
});

describe('getApiErrorCode', () => {
  it('surfaces the machine-readable errorCode', () => {
    const err = axiosErrorWith({ errorCode: 'PROFILE_PHONE_REQUIRED' });
    expect(getApiErrorCode(err)).toBe('PROFILE_PHONE_REQUIRED');
  });

  it('is undefined when absent or non-axios', () => {
    expect(getApiErrorCode(axiosErrorWith({}))).toBeUndefined();
    expect(getApiErrorCode(new Error('boom'))).toBeUndefined();
  });
});

describe('getApiErrorStatus', () => {
  it('returns the HTTP status', () => {
    expect(getApiErrorStatus(axiosErrorWith({}, 409))).toBe(409);
  });

  it('is undefined when no response landed (network failure contract)', () => {
    const headers = new AxiosHeaders();
    const noResponse = new AxiosError('Network Error', 'ERR_NETWORK', {
      headers,
    } as never);
    expect(getApiErrorStatus(noResponse)).toBeUndefined();
    expect(getApiErrorStatus(new Error('boom'))).toBeUndefined();
  });
});

import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
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

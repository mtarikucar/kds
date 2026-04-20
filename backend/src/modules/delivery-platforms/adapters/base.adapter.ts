import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

export abstract class BaseAdapter {
  protected readonly logger: Logger;
  protected readonly httpClient: AxiosInstance;
  protected readonly baseURL: string;

  constructor(name: string, defaultBaseURL: string, timeout = 10_000) {
    this.logger = new Logger(name);
    this.baseURL = defaultBaseURL;
    this.httpClient = axios.create({ baseURL: defaultBaseURL, timeout });
  }

  /** Allow overriding baseURL from env (call in subclass constructor if ConfigService is available) */
  protected overrideBaseURL(url: string | undefined) {
    if (url) {
      this.httpClient.defaults.baseURL = url;
    }
  }

  protected async request<T = any>(
    config: AxiosRequestConfig,
    retries = 2,
  ): Promise<AxiosResponse<T>> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.httpClient.request<T>(config);
        return response;
      } catch (error: any) {
        lastError = error;
        const status = error.response?.status;

        // Don't retry on client errors (except 429 rate limit)
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw error;
        }

        if (attempt < retries) {
          // Honour the platform's Retry-After if present; otherwise back
          // off exponentially. Retry-After can be seconds or an HTTP-date.
          const retryAfter = error.response?.headers?.['retry-after'];
          let delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          if (retryAfter) {
            const asNum = Number(retryAfter);
            if (Number.isFinite(asNum)) {
              delay = Math.min(asNum * 1000, 30_000);
            } else {
              const date = Date.parse(retryAfter);
              if (Number.isFinite(date)) {
                delay = Math.min(Math.max(date - Date.now(), 0), 30_000);
              }
            }
          }
          this.logger.warn(
            `Request failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms: ${error.message}`,
          );
          await this.sleep(delay);
        }
      }
    }

    throw lastError ?? new Error('Request failed without a recorded error');
  }

  protected getAuthHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

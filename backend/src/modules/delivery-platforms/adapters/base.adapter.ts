import { Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

export abstract class BaseAdapter {
  protected readonly logger: Logger;
  protected readonly httpClient: AxiosInstance;

  constructor(name: string, baseURL: string, timeout = 10_000) {
    this.logger = new Logger(name);
    this.httpClient = axios.create({ baseURL, timeout });
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
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          this.logger.warn(
            `Request failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms: ${error.message}`,
          );
          await this.sleep(delay);
        }
      }
    }

    throw lastError;
  }

  protected getAuthHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

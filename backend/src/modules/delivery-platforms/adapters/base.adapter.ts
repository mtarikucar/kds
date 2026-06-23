import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DeliveryPlatformConfig } from "@prisma/client";
import { numericEnv } from "../../../common/config/numeric-env.util";
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";

export abstract class BaseAdapter {
  protected readonly logger: Logger;
  protected readonly httpClient: AxiosInstance;
  /** Production base URL (the axios instance default). */
  protected baseURL: string;
  /**
   * Sandbox/test base URL. Selected per-request when a config has
   * environment === "sandbox" (see resolveBaseURL). Defaults to the
   * production base URL when a platform has no dedicated sandbox host.
   */
  protected sandboxBaseURL: string;

  constructor(
    name: string,
    defaultBaseURL: string,
    config?: ConfigService,
    timeout?: number,
    sandboxBaseURL?: string,
  ) {
    this.logger = new Logger(name);
    this.baseURL = defaultBaseURL;
    this.sandboxBaseURL = sandboxBaseURL ?? defaultBaseURL;
    // Per-request HTTP timeout. Default 10s; override via
    // DELIVERY_PLATFORM_HTTP_TIMEOUT_MS. An explicit `timeout` arg (rare)
    // still wins so a subclass can hard-pin a value if it ever needs to.
    const resolvedTimeout =
      timeout ??
      numericEnv(config?.get("DELIVERY_PLATFORM_HTTP_TIMEOUT_MS"), 10_000);
    this.httpClient = axios.create({
      baseURL: defaultBaseURL,
      timeout: resolvedTimeout,
    });
  }

  /** Allow overriding the production baseURL from env (call in subclass constructor if ConfigService is available) */
  protected overrideBaseURL(url: string | undefined) {
    if (url) {
      this.baseURL = url;
      this.httpClient.defaults.baseURL = url;
    }
  }

  /** Allow overriding the sandbox baseURL from env (call in subclass constructor if ConfigService is available) */
  protected overrideSandboxBaseURL(url: string | undefined) {
    if (url) {
      this.sandboxBaseURL = url;
    }
  }

  /**
   * True only when this adapter has a *real*, distinct sandbox endpoint — i.e.
   * sandboxBaseURL is set AND differs from the production baseURL.
   *
   * SANDBOX-FAIL-CLOSED: several platforms (Getir, Yemeksepeti, Migros) have
   * no publicly documented test host, so their sandboxBaseURL defaults to the
   * production host. For those, a config with environment === "sandbox" still
   * resolves to PRODUCTION, which would make the test-order simulator's
   * sandbox-only guard a no-op and let a synthetic order auto-accept against
   * the LIVE platform. Callers (notably DeliveryTestService.simulateOrder)
   * MUST consult this before treating a "sandbox" config as safe to hit, and
   * refuse when it returns false. Trendyol returns true once its distinct
   * stage host is configured.
   */
  hasRealSandbox(): boolean {
    return !!this.sandboxBaseURL && this.sandboxBaseURL !== this.baseURL;
  }

  /**
   * Resolve the base URL for a given config: the platform's sandbox host when
   * config.environment === "sandbox", otherwise the production host. Adapters
   * pass the result as the per-request `baseURL` (axios merges a per-request
   * baseURL over the instance default), so a single singleton adapter can
   * serve both production and sandbox tenant configs simultaneously.
   */
  protected resolveBaseURL(config?: DeliveryPlatformConfig): string {
    return config?.environment === "sandbox"
      ? this.sandboxBaseURL
      : this.baseURL;
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
          const retryAfter = error.response?.headers?.["retry-after"];
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

    throw lastError ?? new Error("Request failed without a recorded error");
  }

  protected getAuthHeaders(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

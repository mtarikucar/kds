import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { promises as fs } from "fs";
import * as path from "path";
import axios from "axios";
import { PrismaService } from "../../../prisma/prisma.service";
import { MenuAiQuotaService } from "./menu-ai-quota.service";
import { withAdvisoryLock } from "../../../common/scheduling/advisory-lock";

const MESHY_BASE = "https://api.meshy.ai/openapi/v1/image-to-3d";

/**
 * Turns a dish photo into a 3D model (GLB + USDZ) via Meshy, then re-hosts the
 * assets locally so the QR-menu AR viewer keeps working after Meshy's signed
 * URLs expire. Phase 2 of the menu AI-AR feature.
 *
 * Ships INERT: with no MESHY_API_KEY (and simulator off) requestModel() throws
 * a clear "not configured" — mirrors the payment-terminal CONFIGURED_NOT_ACTIVE
 * gate. Set MESHY_SIMULATOR=true to exercise the full flow without the API.
 */
@Injectable()
export class Product3dService {
  private readonly logger = new Logger(Product3dService.name);
  private readonly uploadsRoot = path.resolve(process.cwd(), "uploads");
  private readonly modelsDir = path.join(this.uploadsRoot, "models");
  private readonly baseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly quota: MenuAiQuotaService,
  ) {
    this.baseUrl =
      this.config.get<string>("BACKEND_URL") || "http://localhost:3000";
  }

  private get apiKey(): string | undefined {
    return this.config.get<string>("MESHY_API_KEY");
  }

  private get simulator(): boolean {
    return this.config.get<string>("MESHY_SIMULATOR") === "true";
  }

  isConfigured(): boolean {
    return !!this.apiKey || this.simulator;
  }

  /** Read-only current 3D state for a product (never triggers generation). */
  async getStatus(productId: string, tenantId: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: {
        id: true,
        model3dStatus: true,
        model3dUrl: true,
        model3dUsdzUrl: true,
        model3dError: true,
      },
    });
    if (!product) throw new NotFoundException("Product not found");
    return this.view(product);
  }

  /**
   * Kick off 3D generation for a product's dish photo. Returns immediately with
   * status PENDING (the cron poller finishes it). Idempotent: a product already
   * PENDING/READY is returned unchanged unless force=true.
   */
  async requestModel(productId: string, tenantId: string, force = false) {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        "3D generation is not configured (MESHY_API_KEY missing).",
      );
    }
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      include: {
        productImages: {
          include: { image: true },
          orderBy: { order: "asc" },
          take: 1,
        },
      },
    });
    if (!product) throw new NotFoundException("Product not found");

    if (
      !force &&
      (product.model3dStatus === "PENDING" || product.model3dStatus === "READY")
    ) {
      return this.view(product);
    }

    const imageUrl = this.resolveDishImageUrl(product);
    if (!imageUrl) {
      throw new BadRequestException(
        "This product has no photo to build a 3D model from — add a dish image first.",
      );
    }

    // Every Meshy submit is a real vendor charge, and ?force=true (plus
    // TRIAL's unlimited products) would otherwise make it an unmetered loop.
    // 3D draws from the PHOTO allowance — no separate 3D cap, but every
    // generation consumes ledger units; a FAILED task refunds via markFailed.
    const usageId = await this.quota.claim(tenantId, "PHOTO", 1);

    // Simulator: skip Meshy, mark READY immediately with a sample model so the
    // whole request → AR-viewer path is exercisable without the API/credits.
    if (!this.apiKey && this.simulator) {
      const sampleGlb =
        this.config.get<string>("MESHY_SAMPLE_GLB_URL") ||
        "https://modelviewer.dev/shared-assets/models/Astronaut.glb";
      const sampleUsdz =
        this.config.get<string>("MESHY_SAMPLE_USDZ_URL") ||
        "https://modelviewer.dev/shared-assets/models/Astronaut.usdz";
      const updated = await this.prisma.product.update({
        where: { id: product.id },
        data: {
          model3dStatus: "READY",
          model3dUrl: sampleGlb,
          model3dUsdzUrl: sampleUsdz,
          model3dTaskId: "SIMULATED",
          model3dError: null,
        },
      });
      await this.quota
        .attachJob(usageId, `meshy:sim:${product.id}`)
        .catch(() => undefined);
      return this.view(updated);
    }

    let taskId: string;
    try {
      const res = await axios.post(
        MESHY_BASE,
        {
          image_url: imageUrl,
          ai_model: "latest",
          should_texture: true,
          target_formats: ["glb", "usdz"],
        },
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          timeout: 30_000,
        },
      );
      taskId = res.data?.result;
      if (!taskId) throw new Error("no task id in Meshy response");
    } catch (err: any) {
      // No Meshy task exists — refund the claim.
      await this.quota.voidUsage(usageId).catch(() => undefined);
      const detail = err?.response?.data?.message ?? err?.message;
      this.logger.error(`Meshy create-task failed (${product.id}): ${detail}`);
      throw new ServiceUnavailableException(
        "3D generation service is temporarily unavailable — try again.",
      );
    }

    // Soft link (jobId is a plain string ref) so a later FAILED/CANCELED task
    // refunds via markFailed → voidByJob("meshy:<taskId>").
    await this.quota
      .attachJob(usageId, `meshy:${taskId}`)
      .catch(() => undefined);
    const updated = await this.prisma.product.update({
      where: { id: product.id },
      data: {
        model3dStatus: "PENDING",
        model3dTaskId: taskId,
        model3dError: null,
      },
    });
    return this.view(updated);
  }

  /**
   * Poll all PENDING (real, non-simulated) tasks every 30s: on SUCCEEDED,
   * download the GLB + USDZ and re-host them; on FAILED, record the reason.
   * Advisory-locked so only one replica polls (and re-downloads) per tick;
   * tenant-agnostic — the taskId is globally unique.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async pollPendingModels(): Promise<void> {
    if (!this.apiKey) return; // real polling only; simulator finishes inline
    // Multi-replica guard: one replica per tick polls the Meshy task queue,
    // so N replicas don't re-poll (and re-download) the same tasks.
    await withAdvisoryLock(
      this.prisma,
      "product3d.pollPendingModels",
      () => this.pollPendingModelsInner(),
      this.logger,
    );
  }

  private async pollPendingModelsInner(): Promise<void> {
    const pending = await this.prisma.product.findMany({
      where: {
        model3dStatus: "PENDING",
        model3dTaskId: { not: null },
      },
      select: { id: true, model3dTaskId: true },
      take: 20,
    });
    for (const p of pending) {
      await this.pollOne(p.id, p.model3dTaskId as string).catch((e) =>
        this.logger.warn(`poll ${p.id} failed: ${(e as Error).message}`),
      );
    }
  }

  private async pollOne(productId: string, taskId: string): Promise<void> {
    if (taskId === "SIMULATED") return;
    const res = await axios.get(`${MESHY_BASE}/${taskId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
      timeout: 30_000,
    });
    const status = res.data?.status;
    if (status === "SUCCEEDED") {
      const glbUrl = res.data?.model_urls?.glb;
      const usdzUrl = res.data?.model_urls?.usdz;
      if (!glbUrl) {
        await this.markFailed(productId, "Meshy returned no GLB", taskId);
        return;
      }
      // Re-host locally so the AR viewer survives Meshy's signed-URL expiry.
      const glbPath = await this.download(glbUrl, `${productId}.glb`);
      const usdzPath = usdzUrl
        ? await this.download(usdzUrl, `${productId}.usdz`).catch(() => null)
        : null;
      await this.prisma.product.update({
        where: { id: productId },
        data: {
          model3dStatus: "READY",
          model3dUrl: `${this.baseUrl}/uploads/models/${glbPath}`,
          model3dUsdzUrl: usdzPath
            ? `${this.baseUrl}/uploads/models/${usdzPath}`
            : null,
          model3dError: null,
        },
      });
      this.logger.log(`3D model ready for product ${productId}`);
    } else if (status === "FAILED" || status === "CANCELED") {
      await this.markFailed(
        productId,
        res.data?.task_error?.message ?? `Meshy task ${status}`,
        taskId,
      );
    }
    // PENDING / IN_PROGRESS: leave it; the next tick re-checks.
  }

  private async markFailed(
    productId: string,
    reason: string,
    taskId?: string,
  ): Promise<void> {
    await this.prisma.product.update({
      where: { id: productId },
      data: { model3dStatus: "FAILED", model3dError: reason.slice(0, 500) },
    });
    // Failed generation = refund the quota claim (soft-linked at submit).
    if (taskId) {
      await this.quota.voidByJob(`meshy:${taskId}`).catch(() => undefined);
    }
  }

  private async download(url: string, filename: string): Promise<string> {
    await fs.mkdir(this.modelsDir, { recursive: true });
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 120_000,
    });
    await fs.writeFile(
      path.join(this.modelsDir, filename),
      Buffer.from(res.data),
    );
    return filename;
  }

  /** Resolve a product's dish photo to an absolute, publicly-fetchable URL. */
  private resolveDishImageUrl(product: any): string | null {
    const raw = product.image || product.productImages?.[0]?.image?.url || null;
    if (!raw) return null;
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    if (raw.startsWith("/")) return `${this.baseUrl}${raw}`;
    return `${this.baseUrl}/${raw}`;
  }

  private view(product: any) {
    return {
      productId: product.id,
      status: product.model3dStatus ?? null,
      glbUrl: product.model3dUrl ?? null,
      usdzUrl: product.model3dUsdzUrl ?? null,
      error: product.model3dError ?? null,
    };
  }
}

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
import { withAdvisoryLock } from "../../../common/scheduling/advisory-lock";
import { MenuAiQuotaService } from "./menu-ai-quota.service";

const FAL_QUEUE = "https://queue.fal.run";
const MAX_POLL_ATTEMPTS = 40; // ~20 min at 30s ticks → FAILED (timeout)

/**
 * fal.ai-backed AI media for menu products. Every generation is an async JOB
 * (ProductMediaJob) submitted to the fal QUEUE, so the UI can show REAL progress
 * and offer VARIATIONS to pick from:
 *  - PHOTO:  text-to-image (FLUX) → dish photo candidates (library images).
 *  - FRAME:  the exploded "ingredients flying above the plate" still candidates.
 *  - VIDEO:  a Kling dish→ingredients video from the chosen frame.
 * A single 30s @Cron polls all in-flight jobs (status + progress logs), then
 * finalises per kind. Committed outputs land on Product.image /
 * ingredientsImageUrl / videoUrl + the ProductImage library.
 *
 * Ships INERT: no FAL_KEY (and simulator off) → clear "not configured".
 * FAL_SIMULATOR=true finishes jobs inline with sample assets (no real fal).
 */
@Injectable()
export class ProductMediaService {
  private readonly logger = new Logger(ProductMediaService.name);
  private readonly mediaDir = path.join(process.cwd(), "uploads", "media");
  private readonly baseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly quota: MenuAiQuotaService,
  ) {
    this.baseUrl =
      this.config.get<string>("BACKEND_URL") || "http://localhost:3000";
  }

  private get key(): string | undefined {
    return this.config.get<string>("FAL_KEY");
  }
  private get simulator(): boolean {
    return this.config.get<string>("FAL_SIMULATOR") === "true";
  }
  private get imageModel(): string {
    return this.config.get<string>("FAL_IMAGE_MODEL") || "fal-ai/flux/dev";
  }
  private get videoModel(): string {
    return (
      this.config.get<string>("FAL_VIDEO_MODEL") ||
      "fal-ai/kling-video/o1/standard/image-to-video"
    );
  }

  isConfigured(): boolean {
    return !!this.key || this.simulator;
  }

  // ── status ─────────────────────────────────────────────────────────────────
  async getStatus(productId: string, tenantId: string) {
    const p = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: {
        id: true,
        image: true,
        videoUrl: true,
        videoStatus: true,
        videoError: true,
        ingredientsImageUrl: true,
      },
    });
    if (!p) throw new NotFoundException("Product not found");
    const jobs = await this.prisma.productMediaJob.findMany({
      where: { productId, tenantId },
      orderBy: { createdAt: "desc" },
      take: 12,
    });
    return {
      productId: p.id,
      imageUrl: p.image ?? null,
      videoUrl: p.videoUrl ?? null,
      videoStatus: p.videoStatus ?? null,
      videoError: p.videoError ?? null,
      ingredientsImageUrl: p.ingredientsImageUrl ?? null,
      jobs: jobs.map((j) => this.jobView(j)),
    };
  }

  private jobView(j: any) {
    return {
      id: j.id,
      kind: j.kind,
      status: j.status,
      percent: j.percent ?? null,
      queuePosition: j.queuePosition ?? null,
      lastLog: j.lastLog ?? null,
      error: j.error ?? null,
      resultUrls: (j.resultUrls as string[] | null) ?? [],
      createdAt: j.createdAt,
    };
  }

  // ── PHOTO ──────────────────────────────────────────────────────────────────
  async generatePhoto(
    productId: string,
    tenantId: string,
    opts: { prompt?: string; count?: number } = {},
  ) {
    this.assertConfigured();
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { id: true, name: true, description: true, ingredients: true },
    });
    if (!product) throw new NotFoundException("Product not found");

    const ingredientNames = this.parseIngredientNames(product.ingredients).join(
      ", ",
    );
    const prompt =
      opts.prompt?.trim() ||
      `A realistic, appetising photograph of the dish "${product.name}"${
        product.description ? `, ${product.description}` : ""
      }${
        ingredientNames ? `, made with ${ingredientNames}` : ""
      }, professionally plated on a clean plate, restaurant menu food photography, natural soft light, 45-degree angle, high detail, no text, no watermark`;
    const count = this.clampCount(opts.count);

    // Atomic quota claim BEFORE any fal traffic; submitImageJob refunds it
    // if the submit never becomes a job.
    const usageId = await this.quota.claim(tenantId, "PHOTO", count);
    return this.submitImageJob(
      "PHOTO",
      product.id,
      tenantId,
      prompt,
      count,
      usageId,
    );
  }

  // ── FRAME (ingredients last frame) ──────────────────────────────────────────
  async generateIngredientsFrame(
    productId: string,
    tenantId: string,
    opts: { prompt?: string; count?: number } = {},
  ) {
    this.assertConfigured();
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { id: true, name: true, description: true, ingredients: true },
    });
    if (!product) throw new NotFoundException("Product not found");

    const names = this.parseIngredientNames(product.ingredients);
    if (names.length === 0) {
      throw new BadRequestException(
        "Add the ingredients (İçindekiler) first — the video reveals them.",
      );
    }
    let prompt = opts.prompt?.trim();
    if (!prompt) {
      const english = await this.translateIngredients(names.slice(0, 8));
      prompt = `A dramatic food levitation photograph of the dish "${product.name}"${
        product.description ? ` (${product.description})` : ""
      }: the finished dish rests on a rustic plate at the bottom, and ALL of its raw ingredients — ${english.join(", ")} — fly and float UP in the air above and around the plate; EVERY one of these ingredients is clearly visible and present, well separated and spread apart across the frame, with dynamic sauce splashes; dark moody background, dramatic side light, professional food photography, sharp focus, high detail, absolutely no text, no labels, no writing`;
    }
    const count = this.clampCount(opts.count);
    // FRAME draws from the PHOTO allowance — same image model, same cost.
    const usageId = await this.quota.claim(tenantId, "PHOTO", count);
    return this.submitImageJob(
      "FRAME",
      product.id,
      tenantId,
      prompt,
      count,
      usageId,
    );
  }

  /** Create the job row AND link it to the quota claim atomically. A
      non-atomic create→attach pair had a real failure window: attach throws
      after the job row exists → the catch refunds the claim while the poller
      later delivers the media (quota-free generation). One transaction means
      either "job exists and is linked (refundable via failJob→voidByJob)" or
      "nothing exists (refundable via voidUsage)". */
  private createLinkedJob(
    usageId: string,
    data: Parameters<PrismaService["productMediaJob"]["create"]>[0]["data"],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.productMediaJob.create({ data });
      await tx.aiGenerationUsage.update({
        where: { id: usageId },
        data: { jobId: job.id },
      });
      return job;
    });
  }

  /** Submit an image (PHOTO/FRAME) job to the fal queue (or finish inline in
      the simulator). `usageId` is the already-claimed quota ledger row: it is
      linked to the job atomically at job creation and refunded only when no
      job row ever materialised. */
  private async submitImageJob(
    kind: "PHOTO" | "FRAME",
    productId: string,
    tenantId: string,
    prompt: string,
    count: number,
    usageId: string,
  ) {
    let job: { id: string } | null = null;
    try {
      if (!this.key && this.simulator) {
        const files = await Promise.all(
          Array.from({ length: count }, (_, i) =>
            this.storeFromUrl(
              this.sample("image"),
              `${productId}-${kind.toLowerCase()}-${Date.now()}-${i}.png`,
            ),
          ),
        );
        const urls = files.map((f) => this.hosted(f));
        job = await this.createLinkedJob(usageId, {
          productId,
          tenantId,
          kind,
          status: "COMPLETED",
          prompt,
          count,
          percent: 100,
          resultUrls: urls,
        });
        await this.finalizeImageJob(job, urls);
        return this.jobView(await this.reload(job.id));
      }
      const requestId = await this.submitQueue(this.imageModel, {
        prompt,
        image_size: "square_hd",
        num_images: count,
      });
      job = await this.createLinkedJob(usageId, {
        productId,
        tenantId,
        kind,
        status: "IN_QUEUE",
        falRequestId: requestId,
        prompt,
        count,
      });
      return this.jobView(job);
    } catch (err) {
      if (!job) {
        // Nothing pollable exists — refund so a fal outage doesn't burn the
        // tenant's monthly allowance.
        await this.quota.voidUsage(usageId).catch(() => undefined);
      }
      // else: the job row exists and is linked — the media may still be
      // delivered by the poller, so the claim stays consumed; a genuine
      // failure refunds later via failJob → voidByJob.
      throw err;
    }
  }

  // ── VIDEO ──────────────────────────────────────────────────────────────────
  async generateIngredientsVideo(
    productId: string,
    tenantId: string,
    opts: { prompt?: string } = {},
  ) {
    this.assertConfigured();
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

    const dishPhoto = this.resolveDishImageUrl(product);
    if (!dishPhoto) {
      throw new BadRequestException(
        "Add a dish photo first — the video starts from the product's photo.",
      );
    }
    const endFrame = product.ingredientsImageUrl;
    if (!endFrame) {
      throw new BadRequestException(
        "Generate the ingredients last frame first, then create the video.",
      );
    }
    const prompt =
      opts.prompt?.trim() ||
      `Smooth cinematic transition from the finished plated dish to a display of its fresh raw ingredients. Photorealistic appetising food video, soft light, gentle motion, no text, no letters.`;

    // Atomic quota claim BEFORE any fal traffic; refunded below only if no
    // job row ever materialised.
    const usageId = await this.quota.claim(tenantId, "VIDEO", 1);
    let job: { id: string } | null = null;
    try {
      if (!this.key && this.simulator) {
        const stored = await this.storeFromUrl(
          this.sample("video"),
          `${productId}-video-${Date.now()}.mp4`,
        );
        job = await this.createLinkedJob(usageId, {
          productId,
          tenantId,
          kind: "VIDEO",
          status: "COMPLETED",
          prompt,
          percent: 100,
          resultUrls: [stored],
        });
        await this.finalizeVideoJob(job, stored);
        return this.jobView(await this.reload(job.id));
      }

      const requestId = await this.submitQueue(this.videoModel, {
        prompt,
        start_image_url: dishPhoto,
        end_image_url: endFrame,
      });
      job = await this.createLinkedJob(usageId, {
        productId,
        tenantId,
        kind: "VIDEO",
        status: "IN_QUEUE",
        falRequestId: requestId,
        prompt,
      });
      // Best-effort UI mirror OUTSIDE the refund path: a P2025 here (e.g.
      // concurrent product delete) must not refund a claim whose fal job is
      // live — the poller/failJob rails own the outcome from this point.
      await this.prisma.product
        .update({
          where: { id: product.id },
          data: {
            videoStatus: "PENDING",
            videoTaskId: requestId,
            videoError: null,
          },
        })
        .catch((e) =>
          this.logger.warn(
            `videoStatus mirror update failed for ${product.id}: ${e?.message}`,
          ),
        );
      return this.jobView(job);
    } catch (err) {
      if (!job) {
        await this.quota.voidUsage(usageId).catch(() => undefined);
      }
      throw err;
    }
  }

  // ── set the product's primary image (pick a variation, by URL) ──────────────
  async setPrimaryImage(productId: string, tenantId: string, imageUrl: string) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { id: true },
    });
    if (!product) throw new NotFoundException("Product not found");
    const img = await this.prisma.productImage.findFirst({
      where: { url: imageUrl, tenantId },
      select: { id: true, url: true },
    });
    if (!img) throw new NotFoundException("Image not found");

    // The scalar product.image is the primary shown everywhere (QR card, admin).
    // AI candidates live only in the tenant media library — they are NOT linked
    // into the product's public gallery (ProductToImage), so picking a primary
    // is a single scalar write and never pollutes the customer-facing carousel.
    await this.prisma.product.update({
      where: { id: productId },
      data: { image: img.url },
    });
    return { productId, imageUrl: img.url, imageId: img.id };
  }

  // ── poll cron: all in-flight jobs ───────────────────────────────────────────
  @Cron(CronExpression.EVERY_30_SECONDS)
  async pollPendingJobs(): Promise<void> {
    if (!this.key) return; // real polling only; simulator finishes inline
    // Multi-replica guard: one replica per tick polls the fal.ai queue.
    // Without it every replica polls the same in-flight jobs, burning
    // duplicate external API quota.
    await withAdvisoryLock(
      this.prisma,
      "productMedia.pollPendingJobs",
      () => this.pollPendingJobsInner(),
      this.logger,
    );
  }

  private async pollPendingJobsInner(): Promise<void> {
    const jobs = await this.prisma.productMediaJob.findMany({
      where: {
        status: { in: ["IN_QUEUE", "IN_PROGRESS"] },
        falRequestId: { not: null },
      },
      orderBy: { createdAt: "asc" }, // oldest-first fairness (no starvation)
      take: 30,
    });
    for (const job of jobs) {
      await this.pollJob(job).catch((e) =>
        this.logger.warn(
          `media job ${job.id} poll failed: ${(e as Error).message}`,
        ),
      );
    }
  }

  private async pollJob(job: any): Promise<void> {
    const model = job.kind === "VIDEO" ? this.videoModel : this.imageModel;
    const appId = model.split("/").slice(0, 2).join("/");
    const base = `${FAL_QUEUE}/${appId}/requests/${job.falRequestId}`;
    let statusData: any;
    try {
      const res = await axios.get(`${base}/status?logs=1`, {
        headers: { Authorization: `Key ${this.key}` },
        timeout: 30_000,
      });
      statusData = res.data;
    } catch (e) {
      // Attempt cap → give up (timeout / permanently stuck).
      const attempts = job.attempts + 1;
      if (attempts >= MAX_POLL_ATTEMPTS) {
        await this.failJob(job, "Zaman aşımı — tekrar deneyin.");
        return;
      }
      await this.prisma.productMediaJob.update({
        where: { id: job.id },
        data: { attempts },
      });
      throw e;
    }

    const s = statusData?.status;
    const percent = this.parsePercent(statusData);
    const queuePosition =
      typeof statusData?.queue_position === "number"
        ? statusData.queue_position
        : null;
    const lastLog = this.lastLog(statusData);

    if (s === "COMPLETED") {
      // Atomically CLAIM the job before the (slow) download+finalize so a second
      // overlapping poll / another replica cannot finalize it twice (which would
      // create duplicate library rows). Only the poll whose updateMany flips
      // IN_QUEUE/IN_PROGRESS → FINALIZING proceeds.
      const claim = await this.prisma.productMediaJob.updateMany({
        where: { id: job.id, status: { in: ["IN_QUEUE", "IN_PROGRESS"] } },
        data: { status: "FINALIZING" },
      });
      if (claim.count !== 1) return; // someone else claimed it
      try {
        const result = await axios.get(base, {
          headers: { Authorization: `Key ${this.key}` },
          timeout: 30_000,
        });
        if (job.kind === "VIDEO") {
          const videoUrl = result.data?.video?.url;
          if (!videoUrl) return this.failJob(job, "fal returned no video");
          const stored = await this.storeFromUrl(
            videoUrl,
            `${job.productId}-${job.falRequestId}.mp4`,
          );
          await this.finalizeVideoJob(job, stored);
        } else {
          const images: any[] = result.data?.images ?? [];
          if (images.length === 0)
            return this.failJob(job, "fal returned no image");
          const files = await Promise.all(
            images.map((im, i) =>
              this.storeFromUrl(
                im.url,
                `${job.productId}-${job.kind.toLowerCase()}-${job.falRequestId}-${i}.png`,
              ),
            ),
          );
          await this.finalizeImageJob(
            job,
            files.map((f) => this.hosted(f)),
          );
        }
      } catch (e) {
        // The result-fetch / download failed (expired fal URL, disk, 5xx). Count
        // it toward the timeout budget and, at the cap, FAIL — otherwise release
        // the claim so the next tick retries. Without this a post-COMPLETED
        // download error would loop forever (never reaching MAX_POLL_ATTEMPTS).
        const attempts = job.attempts + 1;
        if (attempts >= MAX_POLL_ATTEMPTS) {
          await this.failJob(job, "İndirme başarısız — tekrar deneyin.");
        } else {
          await this.prisma.productMediaJob.update({
            where: { id: job.id },
            data: { status: "IN_PROGRESS", attempts },
          });
        }
        this.logger.warn(
          `media job ${job.id} finalize failed: ${(e as Error).message}`,
        );
      }
      return;
    }

    // Still running: record progress.
    const attempts = job.attempts + 1;
    if (attempts >= MAX_POLL_ATTEMPTS) {
      await this.failJob(job, "Zaman aşımı — tekrar deneyin.");
      return;
    }
    await this.prisma.productMediaJob.update({
      where: { id: job.id },
      data: {
        status: s === "IN_PROGRESS" ? "IN_PROGRESS" : "IN_QUEUE",
        percent,
        queuePosition,
        lastLog,
        attempts,
      },
    });
  }

  /** COMPLETED image job → re-host the candidates as library images; if this is
      the product's FIRST photo (no primary yet) promote the first automatically,
      and for a FRAME set the ingredients still to the first candidate. */
  private async finalizeImageJob(
    job: any,
    hostedUrls: string[],
  ): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: job.productId },
      select: { name: true, image: true },
    });
    const label = job.kind === "PHOTO" ? "AI Fotoğraf" : "İçindekiler";
    const imageIds: string[] = [];
    for (const url of hostedUrls) {
      const size = await this.sizeOf(url);
      const img = await this.attachMediaToLibrary(
        job.tenantId,
        url,
        `${product?.name ?? "Ürün"} — ${label}.png`,
        "image/png",
        size,
      );
      imageIds.push(img.id);
    }
    const data: any = {};
    if (job.kind === "PHOTO" && !product?.image) data.image = hostedUrls[0];
    if (job.kind === "FRAME") data.ingredientsImageUrl = hostedUrls[0];
    if (Object.keys(data).length) {
      await this.prisma.product.update({ where: { id: job.productId }, data });
    }
    await this.prisma.productMediaJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        percent: 100,
        resultUrls: hostedUrls,
        error: null,
      },
    });
    this.logger.log(`${job.kind} job ${job.id} completed (${imageIds.length})`);
  }

  private async finalizeVideoJob(
    job: any,
    storedFilename: string,
  ): Promise<void> {
    const hosted = `${this.baseUrl}/uploads/media/${storedFilename}`;
    await this.prisma.product.update({
      where: { id: job.productId },
      data: { videoStatus: "READY", videoUrl: hosted, videoError: null },
    });
    const size = await this.sizeOf(hosted);
    await this.attachMediaToLibrary(
      job.tenantId,
      hosted,
      "İçindekiler videosu.mp4",
      "video/mp4",
      size,
    ).catch((e) =>
      this.logger.warn(`video library attach failed: ${(e as Error).message}`),
    );
    await this.prisma.productMediaJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        percent: 100,
        resultUrls: [hosted],
        error: null,
      },
    });
    this.logger.log(`VIDEO job ${job.id} ready for product ${job.productId}`);
  }

  private async failJob(job: any, reason: string): Promise<void> {
    await this.prisma.productMediaJob.update({
      where: { id: job.id },
      data: { status: "FAILED", error: reason.slice(0, 500) },
    });
    // Failed generation = refund the quota claim (adapter error, timeout).
    await this.quota.voidByJob(job.id).catch(() => undefined);
    if (job.kind === "VIDEO") {
      await this.prisma.product.update({
        where: { id: job.productId },
        data: { videoStatus: "FAILED", videoError: reason.slice(0, 500) },
      });
    }
  }

  /** Best-effort progress % from fal logs (e.g. a "18/28" diffusion step or a
      "progress": 0.6 field). Capped at 95 so it never fakes "done". */
  private parsePercent(statusData: any): number | null {
    if (typeof statusData?.progress === "number") {
      return Math.min(95, Math.round(statusData.progress * 100));
    }
    const logs: any[] = statusData?.logs ?? [];
    for (let i = logs.length - 1; i >= 0; i--) {
      const msg = String(logs[i]?.message ?? "");
      const pct = msg.match(/(\d{1,3})\s*%/);
      if (pct) return Math.min(95, parseInt(pct[1], 10));
      const step = msg.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
      if (step) {
        const done = parseInt(step[1], 10);
        const total = parseInt(step[2], 10) || 1;
        return Math.min(95, Math.round((done / total) * 100));
      }
    }
    return null;
  }

  private lastLog(statusData: any): string | null {
    const logs: any[] = statusData?.logs ?? [];
    const last = logs[logs.length - 1]?.message;
    return last ? String(last).slice(0, 200) : null;
  }

  // ── helpers ──────────────────────────────────────────────────────────────────
  private clampCount(count?: number): number {
    const n = Number(count) || 1;
    return Math.min(4, Math.max(1, Math.round(n)));
  }

  private async submitQueue(
    model: string,
    input: Record<string, unknown>,
  ): Promise<string> {
    try {
      const res = await axios.post(`${FAL_QUEUE}/${model}`, input, {
        headers: { Authorization: `Key ${this.key}` },
        timeout: 30_000,
      });
      const id = res.data?.request_id;
      if (!id) throw new Error("no request_id");
      return id;
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? err?.message;
      this.logger.error(`fal queue submit ${model} failed: ${detail}`);
      throw new ServiceUnavailableException(
        "AI media generation is temporarily unavailable — try again.",
      );
    }
  }

  private parseIngredientNames(ingredients: string | null): string[] {
    return (ingredients ?? "")
      .split(/[,\n;•·]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  private async translateIngredients(names: string[]): Promise<string[]> {
    const key = this.config.get<string>("ANTHROPIC_API_KEY");
    if (!key) return names;
    try {
      const model =
        this.config.get<string>("MENU_IMPORT_MODEL") ||
        "claude-haiku-4-5-20251001";
      const res = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model,
          max_tokens: 500,
          messages: [
            {
              role: "user",
              content: `Translate each Turkish food ingredient to a short, concrete English food term good for an image generator (e.g. "közlenmiş patlıcan" → "roasted eggplant"). Reply with ONLY a JSON array of strings, same order and length. Ingredients: ${JSON.stringify(names)}`,
            },
          ],
        },
        {
          headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          timeout: 30_000,
        },
      );
      const text: string = res.data?.content?.[0]?.text ?? "";
      const match = text.match(/\[[\s\S]*\]/);
      const arr = JSON.parse(match ? match[0] : text);
      if (Array.isArray(arr) && arr.length === names.length) {
        return arr.map((x) => String(x));
      }
    } catch (e) {
      this.logger.warn(`ingredient translate failed: ${(e as Error).message}`);
    }
    return names;
  }

  /** Add a generated asset to the tenant MEDIA LIBRARY (a ProductImage). It is
      deliberately NOT linked into any product's public gallery (ProductToImage)
      — AI photos/frames/videos surface in the library + the studio, and only a
      picked primary reaches the customer via the scalar product.image. Idempotent
      on (tenantId, url) so a re-poll never inserts a duplicate row. */
  private async attachMediaToLibrary(
    tenantId: string,
    url: string,
    filename: string,
    mimeType: string,
    size: number,
  ): Promise<{ id: string }> {
    const existing = await this.prisma.productImage.findFirst({
      where: { url, tenantId },
      select: { id: true },
    });
    if (existing) return existing;
    const img = await this.prisma.productImage.create({
      data: { url, filename, size, mimeType, tenantId },
    });
    return { id: img.id };
  }

  /** Download a remote asset to /uploads/media; returns the stored filename. */
  private async storeFromUrl(url: string, filename: string): Promise<string> {
    await fs.mkdir(this.mediaDir, { recursive: true });
    const res = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 180_000,
    });
    await fs.writeFile(
      path.join(this.mediaDir, filename),
      Buffer.from(res.data),
    );
    return filename;
  }

  private hosted(filename: string): string {
    return `${this.baseUrl}/uploads/media/${filename}`;
  }

  private async sizeOf(hostedUrl: string): Promise<number> {
    const file = hostedUrl.split("/uploads/media/")[1] ?? hostedUrl;
    try {
      return (await fs.stat(path.join(this.mediaDir, file))).size;
    } catch {
      return 0;
    }
  }

  private async reload(jobId: string) {
    return this.prisma.productMediaJob.findUnique({ where: { id: jobId } });
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        "AI media generation is not configured (FAL_KEY missing).",
      );
    }
  }

  private resolveDishImageUrl(product: any): string | null {
    const raw = product.image || product.productImages?.[0]?.image?.url || null;
    if (!raw) return null;
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    if (raw.startsWith("/")) return `${this.baseUrl}${raw}`;
    return `${this.baseUrl}/${raw}`;
  }

  private sample(kind: "image" | "video"): string {
    return kind === "image"
      ? this.config.get<string>("FAL_SAMPLE_IMAGE_URL") ||
          "https://fal.media/files/penguin/sample.png"
      : this.config.get<string>("FAL_SAMPLE_VIDEO_URL") ||
          "https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4";
  }
}

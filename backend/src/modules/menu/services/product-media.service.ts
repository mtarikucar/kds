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

const FAL_SYNC = "https://fal.run";
const FAL_QUEUE = "https://queue.fal.run";

/**
 * fal.ai-backed generated media for menu products (menu AI media feature):
 *  - generatePhoto:  text-to-image (FLUX) → a professional dish photo.
 *  - generateIngredientsVideo:  generate an "ingredients laid out on a table"
 *    still from the product's içindekiler, then a dual-keyframe (Kling
 *    first-frame→last-frame) video that transitions the finished dish photo INTO
 *    those ingredients — a short clip that shows what's inside — and attach it.
 *
 * Ships INERT: no FAL_KEY (and simulator off) → clear "not configured".
 * FAL_SIMULATOR=true exercises the whole flow with sample assets.
 */
@Injectable()
export class ProductMediaService {
  private readonly logger = new Logger(ProductMediaService.name);
  private readonly mediaDir = path.join(process.cwd(), "uploads", "media");
  private readonly baseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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
    return {
      productId: p.id,
      imageUrl: p.image ?? null,
      videoUrl: p.videoUrl ?? null,
      videoStatus: p.videoStatus ?? null,
      videoError: p.videoError ?? null,
      ingredientsImageUrl: p.ingredientsImageUrl ?? null,
    };
  }

  // ── auto product photo ────────────────────────────────────────────────────
  async generatePhoto(productId: string, tenantId: string, prompt?: string) {
    this.assertConfigured();
    const product = await this.prisma.product.findFirst({
      where: { id: productId, tenantId },
      select: { id: true, name: true, description: true },
    });
    if (!product) throw new NotFoundException("Product not found");

    const finalPrompt =
      prompt?.trim() ||
      `Professional food photography of "${product.name}"${
        product.description ? `, ${product.description}` : ""
      }, plated beautifully on a clean table, natural light, high detail, appetising, top restaurant menu style`;

    let imageUrl: string;
    if (!this.key && this.simulator) {
      imageUrl = this.sample("image");
    } else {
      const out = await this.falSync(this.imageModel, {
        prompt: finalPrompt,
        image_size: "square_hd",
        num_images: 1,
      });
      imageUrl = out?.images?.[0]?.url;
      if (!imageUrl) {
        throw new ServiceUnavailableException(
          "Image generation returned no image",
        );
      }
    }
    const stored = await this.download(imageUrl, `${productId}-photo.png`);
    const updated = await this.prisma.product.update({
      where: { id: product.id },
      data: { image: `${this.baseUrl}/uploads/media/${stored}` },
      select: { id: true, image: true },
    });
    return { productId: updated.id, imageUrl: updated.image };
  }

  // ── ingredients video ─────────────────────────────────────────────────────
  async generateIngredientsVideo(productId: string, tenantId: string) {
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

    if (product.videoStatus === "PENDING") return this.videoView(product);

    const dishPhoto = this.resolveDishImageUrl(product);
    if (!dishPhoto) {
      throw new BadRequestException(
        "Add a dish photo first — the video starts from the product's photo.",
      );
    }
    // Parse the ingredient names first — guard on the PARSED result (a value of
    // only separators like ",,," passes .trim() but yields nothing) and cap the
    // count so the prompt stays sane. These names are used to label them, side
    // by side, in the prompt.
    const ingredientParts = (product.ingredients ?? "")
      .split(/[,\n;•·]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ingredientParts.length === 0) {
      throw new BadRequestException(
        "Add the ingredients (İçindekiler) first — the video reveals them.",
      );
    }
    const ingredientNames = ingredientParts.slice(0, 12).join(", ");

    // 1) Generate the "ingredients laid out on a table" still (video end frame).
    // The ingredients are placed side by side in a row and LABELLED (in the
    // generation prompt, not overlaid afterwards) so the video's final moment
    // shows what each one is.
    const ingredientsPrompt = `The raw ingredients (${ingredientNames}) arranged in a single horizontal row, side by side, evenly spaced on a clean neutral table; each ingredient labelled directly above it with its name in an elegant serif font and a small straight downward arrow pointing to it; top-down studio food photography, natural soft light, high detail`;
    let ingredientsImageUrl: string;
    if (!this.key && this.simulator) {
      ingredientsImageUrl = this.sample("image");
    } else {
      const out = await this.falSync(this.imageModel, {
        prompt: ingredientsPrompt,
        image_size: "square_hd",
        num_images: 1,
      });
      ingredientsImageUrl = out?.images?.[0]?.url;
      if (!ingredientsImageUrl) {
        throw new ServiceUnavailableException(
          "Ingredients image generation failed",
        );
      }
    }
    const storedIngredients = await this.download(
      ingredientsImageUrl,
      `${productId}-ingredients.png`,
    );
    const ingredientsHosted = `${this.baseUrl}/uploads/media/${storedIngredients}`;

    // 2) Submit the dual-keyframe transition video (dish → ingredients). The
    // video ENDS on the ingredients laid out side by side, each labelled with
    // its name — the labelling is described here (given to the model as a
    // prompt) rather than overlaid on the still afterwards.
    const videoPrompt = `Smooth cinematic transition from the finished plated dish to its raw ingredients. The video ends with the ingredients laid out side by side in a row on the table, each labelled directly above it with its name (${ingredientNames}) in an elegant serif font with a small straight downward arrow pointing to it.`;
    if (!this.key && this.simulator) {
      const updated = await this.prisma.product.update({
        where: { id: product.id },
        data: {
          ingredientsImageUrl: ingredientsHosted,
          videoStatus: "READY",
          videoUrl: this.sample("video"),
          videoTaskId: "SIMULATED",
          videoError: null,
        },
      });
      return this.videoView(updated);
    }

    let requestId: string;
    try {
      const res = await axios.post(
        `${FAL_QUEUE}/${this.videoModel}`,
        {
          prompt: videoPrompt,
          start_image_url: dishPhoto,
          end_image_url: ingredientsHosted,
        },
        { headers: { Authorization: `Key ${this.key}` }, timeout: 30_000 },
      );
      requestId = res.data?.request_id;
      if (!requestId) throw new Error("no request_id");
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? err?.message;
      this.logger.error(`fal video submit failed (${product.id}): ${detail}`);
      throw new ServiceUnavailableException(
        "Video generation service is temporarily unavailable — try again.",
      );
    }

    const updated = await this.prisma.product.update({
      where: { id: product.id },
      data: {
        ingredientsImageUrl: ingredientsHosted,
        videoStatus: "PENDING",
        videoTaskId: requestId,
        videoError: null,
      },
    });
    return this.videoView(updated);
  }

  /** Poll fal.ai for PENDING videos every 30s; download + attach on completion. */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async pollPendingVideos(): Promise<void> {
    if (!this.key) return; // real polling only; simulator finishes inline
    const pending = await this.prisma.product.findMany({
      where: { videoStatus: "PENDING", videoTaskId: { not: null } },
      select: { id: true, videoTaskId: true },
      take: 20,
    });
    for (const p of pending) {
      await this.pollOne(p.id, p.videoTaskId as string).catch((e) =>
        this.logger.warn(`video poll ${p.id} failed: ${(e as Error).message}`),
      );
    }
  }

  private async pollOne(productId: string, requestId: string): Promise<void> {
    if (requestId === "SIMULATED") return;
    // fal's queue status/result endpoints live under the APP namespace
    // (e.g. fal-ai/kling-video) — the first two path segments — NOT the full
    // model path. Verified against the live API: the full path 405s, the app
    // path returns the task status. Reconstructing from videoModel keeps this
    // correct if the model is swapped via FAL_VIDEO_MODEL.
    const appId = this.videoModel.split("/").slice(0, 2).join("/");
    const base = `${FAL_QUEUE}/${appId}/requests/${requestId}`;
    const status = await axios.get(`${base}/status`, {
      headers: { Authorization: `Key ${this.key}` },
      timeout: 30_000,
    });
    const s = status.data?.status;
    if (s === "COMPLETED") {
      const result = await axios.get(base, {
        headers: { Authorization: `Key ${this.key}` },
        timeout: 30_000,
      });
      const videoUrl = result.data?.video?.url;
      if (!videoUrl) {
        await this.markVideoFailed(productId, "fal returned no video");
        return;
      }
      const stored = await this.download(videoUrl, `${productId}.mp4`);
      await this.prisma.product.update({
        where: { id: productId },
        data: {
          videoStatus: "READY",
          videoUrl: `${this.baseUrl}/uploads/media/${stored}`,
          videoError: null,
        },
      });
      this.logger.log(`ingredients video ready for product ${productId}`);
    }
    // IN_QUEUE / IN_PROGRESS: leave for the next tick. (fal has no FAILED here;
    // a permanently-stuck request is surfaced via the result endpoint erroring,
    // which the caller's catch logs.)
  }

  private async markVideoFailed(productId: string, reason: string) {
    await this.prisma.product.update({
      where: { id: productId },
      data: { videoStatus: "FAILED", videoError: reason.slice(0, 500) },
    });
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        "AI media generation is not configured (FAL_KEY missing).",
      );
    }
  }

  private async falSync(model: string, input: Record<string, unknown>) {
    try {
      const res = await axios.post(`${FAL_SYNC}/${model}`, input, {
        headers: { Authorization: `Key ${this.key}` },
        timeout: 120_000,
      });
      return res.data;
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? err?.message;
      this.logger.error(`fal sync ${model} failed: ${detail}`);
      throw new ServiceUnavailableException(
        "AI media generation is temporarily unavailable — try again.",
      );
    }
  }

  private async download(url: string, filename: string): Promise<string> {
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

  private videoView(product: any) {
    return {
      productId: product.id,
      videoUrl: product.videoUrl ?? null,
      videoStatus: product.videoStatus ?? null,
      videoError: product.videoError ?? null,
      ingredientsImageUrl: product.ingredientsImageUrl ?? null,
    };
  }
}

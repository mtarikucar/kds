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
      select: { id: true, name: true, description: true, ingredients: true },
    });
    if (!product) throw new NotFoundException("Product not found");

    // Build an accurate prompt from the dish name + description + ingredients so
    // the photo reflects the actual product (a caller-supplied prompt wins).
    const ingredientNames = this.parseIngredientNames(product.ingredients).join(
      ", ",
    );
    const finalPrompt =
      prompt?.trim() ||
      `A realistic, appetising photograph of the dish "${product.name}"${
        product.description ? `, ${product.description}` : ""
      }${
        ingredientNames ? `, made with ${ingredientNames}` : ""
      }, professionally plated on a clean plate, restaurant menu food photography, natural soft light, 45-degree angle, high detail, no text, no watermark`;

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
    // A unique filename per generation so re-generating adds a distinct library
    // image instead of silently pointing multiple rows at the same file.
    const filename = `${productId}-photo-${Date.now()}.png`;
    const stored = await this.download(imageUrl, filename);
    const hosted = `${this.baseUrl}/uploads/media/${stored}`;
    const size = (await fs.stat(path.join(this.mediaDir, stored))).size;

    // Add it to the ProductImage LIBRARY (+ link it to the product) AND keep the
    // legacy product.image in sync — so it shows in the editor grid, not just as
    // the scalar primary image.
    const result = await this.prisma.$transaction(async (tx) => {
      const img = await tx.productImage.create({
        data: {
          url: hosted,
          filename: `${product.name} (AI).png`,
          size,
          mimeType: "image/png",
          tenantId,
        },
      });
      const count = await tx.productToImage.count({
        where: { productId: product.id },
      });
      await tx.productToImage.create({
        data: { productId: product.id, imageId: img.id, order: count },
      });
      const updated = await tx.product.update({
        where: { id: product.id },
        data: { image: hosted },
        select: { id: true, image: true },
      });
      return { updated, img };
    });
    return {
      productId: result.updated.id,
      imageUrl: result.updated.image,
      image: result.img,
    };
  }

  /** Parse İçindekiler into up to 12 clean ingredient names (separator-only
      input yields an empty list). */
  private parseIngredientNames(ingredients: string | null): string[] {
    return (ingredients ?? "")
      .split(/[,\n;•·]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  // ── ingredients video, step 1: the LAST FRAME ──────────────────────────────
  // One exploded / food-levitation scene: the dish + ALL its raw ingredients
  // flying up above the plate, every one visible. No labels, no compositing, no
  // vision — just the scene (kept cheap).
  async generateIngredientsFrame(productId: string, tenantId: string) {
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
    const labelled = names.slice(0, 8);
    const englishNames = await this.translateIngredients(labelled);

    // Exploded / food-levitation scene: the dish + ALL its raw ingredients
    // flying up above the plate, every one clearly visible. No text (the model
    // garbles it) and no post-processing — just the scene.
    const explodedPrompt = `A dramatic food levitation photograph of the dish "${product.name}"${
      product.description ? ` (${product.description})` : ""
    }: the finished dish rests on a rustic plate at the bottom, and ALL of its raw ingredients — ${englishNames.join(", ")} — fly and float UP in the air above and around the plate; EVERY one of these ingredients is clearly visible and present, well separated and spread apart across the frame, with dynamic sauce splashes; dark moody background, dramatic side light, professional food photography, sharp focus, high detail, absolutely no text, no labels, no writing`;

    let url: string;
    if (!this.key && this.simulator) {
      url = this.sample("image");
    } else {
      const out = await this.falSync(this.imageModel, {
        prompt: explodedPrompt,
        image_size: "square_hd",
        num_images: 1,
      });
      url = out?.images?.[0]?.url;
      if (!url) {
        throw new ServiceUnavailableException(
          "Ingredients image generation failed",
        );
      }
    }

    const filename = `${productId}-ingredients-${Date.now()}.png`;
    const stored = await this.download(url, filename);
    const hosted = `${this.baseUrl}/uploads/media/${stored}`;
    const size = (await fs.stat(path.join(this.mediaDir, stored))).size;
    await this.attachMediaToLibrary(
      product.id,
      tenantId,
      hosted,
      "İçindekiler (AI).png",
      "image/png",
      size,
    );
    const updated = await this.prisma.product.update({
      where: { id: product.id },
      data: { ingredientsImageUrl: hosted },
    });
    return this.videoView(updated);
  }

  /** Translate Turkish ingredient names to concrete English food terms (better
      image accuracy). Falls back to the originals if Anthropic isn't configured
      or the call fails. */
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
              content: `Translate each Turkish food ingredient to a short, concrete English food term good for an image generator (e.g. "közlenmiş patlıcan" → "roasted eggplant", "süzme yoğurt" → "strained yogurt", "pul biber" → "red pepper flakes"). Reply with ONLY a JSON array of strings, same order and same length, nothing else. Ingredients: ${JSON.stringify(names)}`,
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

  /** Create a tenant ProductImage (image OR video) for a generated asset + link
      it to the product, so every generated photo/video shows in the media
      library. */
  private async attachMediaToLibrary(
    productId: string,
    tenantId: string,
    url: string,
    filename: string,
    mimeType: string,
    size: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const img = await tx.productImage.create({
        data: { url, filename, size, mimeType, tenantId },
      });
      const count = await tx.productToImage.count({ where: { productId } });
      await tx.productToImage.create({
        data: { productId, imageId: img.id, order: count },
      });
    });
  }

  // ── ingredients video, step 2: the VIDEO ───────────────────────────────────
  // Only runs once the last frame has been generated + reviewed — we never
  // generate a video "blind". Uses the reviewed still as the video's end frame.
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
    // The reviewed last frame must already exist (step 1).
    const endFrame = product.ingredientsImageUrl;
    if (!endFrame) {
      throw new BadRequestException(
        "Generate the ingredients last frame first, then create the video.",
      );
    }
    // Smooth reveal from the dish to its ingredients (the reviewed end frame).
    const videoPrompt = `Smooth cinematic transition from the finished plated dish to a display of its fresh raw ingredients. Photorealistic appetising food video, soft light, gentle motion, no text, no letters.`;

    if (!this.key && this.simulator) {
      const updated = await this.prisma.product.update({
        where: { id: product.id },
        data: {
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
          end_image_url: endFrame,
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
      select: { id: true, videoTaskId: true, tenantId: true },
      take: 20,
    });
    for (const p of pending) {
      await this.pollOne(p.id, p.videoTaskId as string, p.tenantId).catch((e) =>
        this.logger.warn(`video poll ${p.id} failed: ${(e as Error).message}`),
      );
    }
  }

  private async pollOne(
    productId: string,
    requestId: string,
    tenantId: string,
  ): Promise<void> {
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
      // Unique filename per video task — a fixed `${productId}.mp4` was
      // overwritten on every re-generate, so the URL never changed and the
      // browser kept serving the CACHED old video ("ekranda ilk yaptığı kalıyor").
      const stored = await this.download(
        videoUrl,
        `${productId}-${requestId}.mp4`,
      );
      const hosted = `${this.baseUrl}/uploads/media/${stored}`;
      await this.prisma.product.update({
        where: { id: productId },
        data: { videoStatus: "READY", videoUrl: hosted, videoError: null },
      });
      // Also surface the video in the media library.
      const size = (await fs.stat(path.join(this.mediaDir, stored))).size;
      await this.attachMediaToLibrary(
        productId,
        tenantId,
        hosted,
        "İçindekiler videosu.mp4",
        "video/mp4",
        size,
      ).catch((e) =>
        this.logger.warn(
          `video library attach failed: ${(e as Error).message}`,
        ),
      );
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

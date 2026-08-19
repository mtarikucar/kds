import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import {
  assertPublicHttpUrl,
  UnsafeUrlError,
} from "../../../common/net/url-safety";
import { numericEnv } from "../../../common/config/numeric-env.util";

export interface FetchedSource {
  bytes: Buffer;
  contentType?: string;
  filename?: string;
  finalUrl: string;
}

/**
 * Fetches the bytes behind an operator-supplied link.
 *
 * This is the one place in the menu module that makes the SERVER talk to an
 * address a USER chose, so it is the whole SSRF surface of the feature.
 * assertPublicHttpUrl runs THREE times, not once:
 *   1. on entry, against the (possibly Sheets-normalised) target,
 *   2. again immediately before the axios.get call,
 *   3. and once more on the final URL, when a redirect actually moved us.
 * Checks 1 and 2 both look safe today, but a malicious DNS server can answer
 * public at validation time and private at connect time — the second check
 * narrows that rebind window rather than trusting the first result to still
 * hold a moment later. Check 3 exists because a redirect can walk us
 * somewhere neither of the first two ever saw. That shape is copied from the
 * outbound-webhook worker, which solved the same problem first.
 */
@Injectable()
export class MenuSourceFetcher {
  private readonly logger = new Logger(MenuSourceFetcher.name);

  constructor(private readonly config: ConfigService) {}

  private get timeoutMs() {
    return numericEnv(this.config?.get("MENU_SOURCE_TIMEOUT_MS"), 15_000);
  }
  private get maxBytes() {
    return numericEnv(
      this.config?.get("MENU_SOURCE_MAX_BYTES"),
      10 * 1024 * 1024,
    );
  }
  private get maxRedirects() {
    return numericEnv(this.config?.get("MENU_SOURCE_MAX_REDIRECTS"), 3);
  }

  async fetch(rawUrl: string): Promise<FetchedSource> {
    const target = normaliseGoogleSheets(rawUrl);

    // Check 1 — validate on entry.
    await this.guard(target);

    // Check 2 — validate again immediately before the socket opens. Nothing
    // observable happens between checks 1 and 2 today, but the point is to
    // keep the gap between "we validated this hostname" and "we connected to
    // it" as small as possible, not to prove the gap is non-empty.
    await this.guard(target);

    let res: any;
    try {
      res = await axios.get(target, {
        responseType: "arraybuffer",
        timeout: this.timeoutMs,
        maxRedirects: this.maxRedirects,
        maxContentLength: this.maxBytes,
        maxBodyLength: this.maxBytes,
        decompress: true,
        validateStatus: (s: number) => s >= 200 && s < 300,
        headers: {
          // Some sites serve a stub to unknown agents. Be honest about who we
          // are rather than impersonating a browser.
          "user-agent": "HummyTummy-MenuImport/1.0 (+https://hummytummy.com)",
          accept: "*/*",
        },
      });
    } catch (err: any) {
      if (
        err?.code === "ERR_FR_MAX_BODY_LENGTH_EXCEEDED" ||
        err?.message?.includes("maxContentLength")
      ) {
        throw new BadRequestException("source is too large to import");
      }
      this.logger.warn(`menu source fetch failed: ${err?.message}`);
      throw new BadRequestException("could not fetch that link");
    }

    // Where we actually ended up after redirects — re-validate it.
    const finalUrl: string = res?.request?.res?.responseUrl ?? target;
    // Check 3 — a redirect can land us somewhere neither entry check saw.
    if (finalUrl !== target) await this.guard(finalUrl);

    const bytes = Buffer.from(res.data);
    if (bytes.length > this.maxBytes) {
      throw new BadRequestException("source is too large to import");
    }

    const contentType: string | undefined = res.headers?.["content-type"];
    assertSheetIsPublic(target, bytes, contentType);

    return {
      bytes,
      contentType,
      filename: filenameFrom(res.headers?.["content-disposition"], finalUrl),
      finalUrl,
    };
  }

  /** Validate, translating the guard's error into a client-safe 400. */
  private async guard(url: string): Promise<void> {
    try {
      await assertPublicHttpUrl(url);
    } catch (e) {
      throw new BadRequestException(
        e instanceof UnsafeUrlError ? e.message : "invalid URL",
      );
    }
  }
}

/**
 * A Google Sheets share link points at the editor, not the data. Rewrite it
 * to the CSV export so the operator can paste the link they actually have.
 */
export function normaliseGoogleSheets(raw: string): string {
  const m = raw.match(
    /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/,
  );
  if (!m) return raw;
  if (raw.includes("/export")) return raw;
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`;
}

/**
 * A Sheet whose sharing is off does NOT 4xx — it answers 200 with a Google
 * sign-in page. Status codes cannot catch that, so look at what came back.
 */
export function assertSheetIsPublic(
  requestedUrl: string,
  bytes: Buffer,
  contentType?: string,
): void {
  if (!requestedUrl.includes("docs.google.com/spreadsheets")) return;
  const looksHtml =
    (contentType ?? "").includes("text/html") ||
    bytes.subarray(0, 200).toString("utf8").toLowerCase().includes("<html");
  if (looksHtml) {
    throw new BadRequestException(
      "that Google Sheet is not publicly readable — set link sharing to anyone with the link",
    );
  }
}

function filenameFrom(disposition?: string, url?: string): string | undefined {
  const fromHeader = disposition?.match(
    /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i,
  )?.[1];
  if (fromHeader) return decodeURIComponent(fromHeader);
  try {
    return url
      ? decodeURIComponent(new URL(url).pathname.split("/").pop() || "") ||
          undefined
      : undefined;
  } catch {
    return undefined;
  }
}

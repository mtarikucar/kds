import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import * as http from "node:http";
import * as https from "node:https";
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
 *
 * axios is never allowed to follow a redirect itself (`maxRedirects: 0`).
 * If it did, all hops would be resolved and connected to before `fetch()`
 * ever saw a URL to validate — the guard would only ever see where the
 * chain ended, after the damage (a live request to whatever the chain
 * pointed at, including any private intermediate hop) was already done.
 * Instead this method walks the chain itself: on every hop it validates
 * the URL with `assertPublicHttpUrl`, pins the connection to the IP that
 * call just resolved, and only then makes the request for that hop. A
 * redirect Location header is read, resolved, and fed back through the
 * same guard-then-connect step before it is ever requested — so a chain
 * like `evil.test → internal-host → evil.test/done` is caught at its
 * middle hop instead of looking clean because its last hop is public.
 *
 * Pinning matters because validating a hostname and connecting to it are
 * two different DNS resolutions unless we force them to be the same one:
 * a malicious DNS server can hand back a public IP to `assertPublicHttpUrl`
 * and a private one to whatever resolves the connection a moment later
 * (DNS rebinding). `assertPublicHttpUrl` already resolves the hostname to
 * decide it's safe, so its `resolvedIp` is threaded into a per-request
 * `http.Agent`/`https.Agent` whose `lookup` hands that same IP back —
 * there is no second, unvalidated resolution left to rebind. The request
 * still carries the real hostname (Host header / TLS SNI), only the
 * low-level socket target is overridden, so vhosts and certificate
 * matching keep working normally.
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
    let currentUrl = normaliseGoogleSheets(rawUrl);
    let redirectHops = 0;
    let res: any;

    for (;;) {
      // Guard THIS hop before requesting it, and pin the socket to the IP
      // that same check just resolved (see class doc comment).
      const { resolvedIp } = await this.guard(currentUrl);
      const protocol = new URL(currentUrl).protocol;
      const agent = pinnedAgent(protocol, resolvedIp);

      try {
        res = await axios.get(currentUrl, {
          responseType: "arraybuffer",
          timeout: this.timeoutMs,
          // We walk redirects ourselves so every hop gets guarded before
          // it is requested — see class doc comment.
          maxRedirects: 0,
          maxContentLength: this.maxBytes,
          maxBodyLength: this.maxBytes,
          decompress: true,
          // 2xx is success; 3xx is a redirect we handle below. Anything
          // else falls through to axios's default rejection.
          validateStatus: (s: number) => s >= 200 && s < 400,
          httpAgent: protocol === "http:" ? agent : undefined,
          httpsAgent: protocol === "https:" ? agent : undefined,
          headers: {
            // Some sites serve a stub to unknown agents. Be honest about who
            // we are rather than impersonating a browser.
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

      if (res.status >= 300 && res.status < 400) {
        redirectHops += 1;
        if (redirectHops > this.maxRedirects) {
          throw new BadRequestException("too many redirects");
        }
        const location = res.headers?.location;
        if (!location) {
          throw new BadRequestException("could not fetch that link");
        }
        // Resolve relative Location headers against the hop we just left,
        // then loop — the NEXT iteration guards this new URL before it is
        // requested. Nothing is fetched from an unguarded hop.
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      break; // 2xx — this is the response we keep.
    }

    const finalUrl = currentUrl;
    const bytes = Buffer.from(res.data);
    if (bytes.length > this.maxBytes) {
      throw new BadRequestException("source is too large to import");
    }

    const contentType: string | undefined = res.headers?.["content-type"];
    // Keyed on finalUrl, not the originally requested URL: a shortened or
    // third-party link that redirects to a private Sheet must still be
    // caught, even though the request the operator pasted was never itself
    // a docs.google.com URL.
    assertSheetIsPublic(finalUrl, bytes, contentType);

    return {
      bytes,
      contentType,
      filename: filenameFrom(res.headers?.["content-disposition"], finalUrl),
      finalUrl,
    };
  }

  /**
   * Validate one hop, translating the guard's error into a client-safe 400,
   * and return the IP `assertPublicHttpUrl` resolved so the caller can pin
   * the connection to it.
   */
  private async guard(url: string): Promise<{ resolvedIp: string }> {
    try {
      const { resolvedIp } = await assertPublicHttpUrl(url);
      return { resolvedIp };
    } catch (e) {
      throw new BadRequestException(
        e instanceof UnsafeUrlError ? e.message : "invalid URL",
      );
    }
  }
}

/**
 * Pin the outbound connection to the IP `assertPublicHttpUrl` already
 * validated, so no second, unvalidated DNS resolution is left to pick a
 * different peer (DNS rebinding). Only the low-level connect target is
 * overridden — the request keeps the real hostname for Host/SNI.
 *
 * Node has shipped `autoSelectFamily` on by default since v20: `net`
 * always calls `lookup` with `{ all: true }` and expects the *array*
 * overload (`(err, [{ address, family }]) => void`), not the classic
 * scalar one. Answering the scalar shape when `all` is set throws
 * `ERR_INVALID_IP_ADDRESS` on every real connection attempt — invisible to
 * a unit suite that mocks axios, since axios's own dispatcher and Node's
 * connection machinery never run. Both shapes are handled here so this
 * keeps working regardless of what a caller's `lookup` options carry.
 */
export function pinnedAgent(
  protocol: string,
  resolvedIp: string,
): http.Agent | https.Agent {
  const family = resolvedIp.includes(":") ? 6 : 4;
  const options = {
    lookup: (
      _hostname: string,
      opts: unknown,
      cb: (
        err: NodeJS.ErrnoException | null,
        address: string | { address: string; family: number }[],
        family?: number,
      ) => void,
    ) => {
      if ((opts as { all?: boolean } | null)?.all) {
        cb(null, [{ address: resolvedIp, family }]);
      } else {
        cb(null, resolvedIp, family);
      }
    },
  };
  return protocol === "https:"
    ? new https.Agent(options)
    : new http.Agent(options);
}

/**
 * A Google Sheets link comes in several shapes an operator might paste:
 *   - a share/edit link, optionally carrying a `/u/<n>` multi-account
 *     segment: rewritten to the CSV export, carrying the selected tab
 *     (`gid`, from the URL fragment or query) along if present;
 *   - a File → Share → Publish-to-web link (`/d/e/<token>/pub...`): left
 *     completely alone, since it already serves the requested format
 *     directly and does not share the `/d/<id>` document-id shape at all;
 *   - an export link already: left alone.
 * Anything that isn't a docs.google.com URL passes through unchanged.
 */
export function normaliseGoogleSheets(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }
  if (url.hostname !== "docs.google.com") return raw;

  // Publish-to-web links already serve the export directly; the segment
  // right after /d/ is the literal marker "e", not a document id.
  if (/^\/spreadsheets\/d\/e\/[^/]+\/pub/.test(url.pathname)) {
    return raw;
  }

  // Share/edit links, with or without a /u/<n> multi-account segment.
  const m = url.pathname.match(
    /^\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9-_]+)/,
  );
  if (!m) return raw;
  if (url.pathname.includes("/export")) return raw;

  const gid = url.searchParams.get("gid") ?? url.hash.match(/gid=(\d+)/)?.[1];
  const exportUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`;
  return gid ? `${exportUrl}&gid=${gid}` : exportUrl;
}

/**
 * A Sheet whose sharing is off does NOT 4xx — it answers 200 with a Google
 * sign-in page. Status codes cannot catch that, so look at what came back.
 */
export function assertSheetIsPublic(
  finalUrl: string,
  bytes: Buffer,
  contentType?: string,
): void {
  if (!finalUrl.includes("docs.google.com/spreadsheets")) return;
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

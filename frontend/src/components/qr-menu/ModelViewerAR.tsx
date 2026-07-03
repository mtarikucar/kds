import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

// Lazy-load Google's <model-viewer> web component only when a customer actually
// opens the AR view — it's a heavy ES module we don't want in the QR-menu's
// critical path. Loaded once, from a CDN (no npm dep), and cached by the browser.
const MV_SRC =
  "https://cdn.jsdelivr.net/npm/@google/model-viewer@4.0.0/dist/model-viewer.min.js";
let mvPromise: Promise<void> | null = null;
function loadModelViewer(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (customElements.get("model-viewer")) return Promise.resolve();
  if (mvPromise) return mvPromise;
  mvPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.type = "module";
    s.src = MV_SRC;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("model-viewer failed to load"));
    document.head.appendChild(s);
  });
  return mvPromise;
}

// <model-viewer> is a custom element — let TS/JSX accept it.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": any;
    }
  }
}

interface Props {
  glbUrl: string;
  usdzUrl?: string | null;
  poster?: string | null;
  alt?: string;
}

/**
 * Phase 3: view a dish's 3D model, with "view in AR on your table" — no app
 * install (iOS AR Quick Look via USDZ, Android Scene Viewer via GLB).
 */
export default function ModelViewerAR({ glbUrl, usdzUrl, poster, alt }: Props) {
  const { t } = useTranslation(["menu", "common"]);
  const [ready, setReady] = useState(
    typeof window !== "undefined" && !!customElements.get("model-viewer"),
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadModelViewer()
      .then(() => !cancelled && setReady(true))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-500">
        {t("menu:ar.loadFailed", "3D görüntüleyici yüklenemedi.")}
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        {t("menu:ar.loading", "3D yükleniyor…")}
      </div>
    );
  }

  return (
    <model-viewer
      src={glbUrl}
      ios-src={usdzUrl || undefined}
      poster={poster || undefined}
      alt={alt || ""}
      ar
      ar-modes="webxr scene-viewer quick-look"
      ar-placement="floor"
      camera-controls
      auto-rotate
      touch-action="pan-y"
      shadow-intensity="1"
      style={{ width: "100%", height: "100%", backgroundColor: "#f8fafc" }}
    >
      <button
        slot="ar-button"
        className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg"
      >
        {t("menu:ar.viewOnTable", "📱 Masanda AR ile gör")}
      </button>
    </model-viewer>
  );
}

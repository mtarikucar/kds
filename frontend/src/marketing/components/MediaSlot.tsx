import { Box, Sparkles, ImageIcon, Expand } from "lucide-react";
import type { ImgKey } from "../data/images";
import { IMG } from "../data/images";
import FramedShot from "./FramedShot";
import MascotFrame from "./MascotFrame";

/**
 * A media placeholder that "designs as if the asset exists". Pass an `img` key
 * and it renders the real asset (framed screenshot for scenes, floating cutout
 * for cutouts). Leave it empty and it renders a premium, branded placeholder
 * with a label — so the layout is built around the eventual bg-removed cutout /
 * 3D model / 4K art the user will supply, instead of looking broken.
 */
export type MediaKind = "3d" | "cutout" | "shot" | "wide";

interface MediaSlotProps {
  img?: ImgKey;
  kind: MediaKind;
  label: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
  frameLabel?: string;
}

const KIND_ICON = {
  "3d": Box,
  cutout: Sparkles,
  shot: ImageIcon,
  wide: Expand,
} as const;
const KIND_ASPECT = {
  "3d": "aspect-square",
  cutout: "aspect-[4/5]",
  shot: "aspect-[4/3]",
  wide: "aspect-[16/9]",
} as const;

export default function MediaSlot({
  img,
  kind,
  label,
  className = "",
  sizes,
  priority,
  frameLabel,
}: MediaSlotProps) {
  if (img) {
    const isScene = IMG[img].kind === "scene";
    if (kind === "shot" || kind === "wide" || isScene) {
      return (
        <FramedShot
          img={img}
          label={frameLabel}
          priority={priority}
          sizes={sizes}
        />
      );
    }
    return (
      <MascotFrame
        img={img}
        priority={priority}
        sizes={sizes}
        className={className}
      />
    );
  }

  const Icon = KIND_ICON[kind];
  return (
    <div
      className={`relative grid ${KIND_ASPECT[kind]} w-full place-items-center overflow-hidden rounded-3xl border-2 border-dashed border-[#e3c9a8] bg-gradient-to-br from-[#fff6ec] to-[#faf1e4] ${className}`}
      role="img"
      aria-label={`${label} (yakında eklenecek görsel)`}
    >
      <div className="absolute inset-0 -z-10 opacity-60 [background-image:radial-gradient(circle_at_30%_20%,rgba(249,115,22,.12),transparent_45%)]" />
      <div className="flex flex-col items-center gap-2 px-6 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/80 text-[#f97316] shadow-sm ring-1 ring-[#f5c9a3]">
          <Icon className="h-7 w-7" />
        </span>
        <span className="text-sm font-semibold text-[#b45309]">{label}</span>
        <span className="text-[11px] font-medium uppercase tracking-wider text-[#c9a06a]">
          {kind === "3d"
            ? "3D model alanı"
            : kind === "cutout"
              ? "Kesilmiş görsel alanı"
              : "4K görsel alanı"}
        </span>
      </div>
    </div>
  );
}

import type { ImgKey } from "../data/images";
import Picture from "./Picture";

interface FramedShotProps {
  img: ImgKey;
  tilt?: boolean;
  label?: string;
  sizes?: string;
  priority?: boolean;
}

/**
 * Wraps a scene-background image in a browser/device card so its (non-transparent)
 * background reads as an intentional product screenshot rather than a floating
 * rectangle on the cream page. Mirrors the original hero mock treatment.
 */
export default function FramedShot({
  img,
  tilt,
  label = "HummyTummy",
  sizes,
  priority,
}: FramedShotProps) {
  return (
    <div className="relative">
      <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-[#fff3e8] to-transparent blur-2xl" />
      <div
        className={`overflow-hidden rounded-2xl border border-[#ece2d4] bg-white p-3 shadow-2xl shadow-stone-900/10 ${
          tilt ? "rotate-1" : ""
        }`}
      >
        <div className="flex items-center gap-1.5 px-1 pb-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#f97316]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#fcd9b6]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#efe6da]" />
          <span className="ml-2 text-xs font-medium text-[#a8a29e]">
            {label}
          </span>
        </div>
        <Picture
          img={img}
          sizes={sizes}
          priority={priority}
          className="w-full rounded-xl bg-[#f4ede1] object-cover"
        />
      </div>
    </div>
  );
}

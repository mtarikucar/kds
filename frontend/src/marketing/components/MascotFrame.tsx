import type { ImgKey } from "../data/images";
import Picture from "./Picture";

interface MascotFrameProps {
  img: ImgKey;
  glow?: boolean;
  sizes?: string;
  priority?: boolean;
  className?: string;
}

/**
 * Cutout-style image (mascot / icon / diorama on a light or flat field) placed
 * directly on the cream page with a soft radial glow + drop shadow, so it feels
 * like a designed object rather than a pasted box.
 */
export default function MascotFrame({
  img,
  glow = true,
  sizes,
  priority,
  className = "",
}: MascotFrameProps) {
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      {glow && (
        <div className="absolute inset-0 -z-10 mx-auto my-auto h-3/4 w-3/4 rounded-full bg-[#f97316]/15 blur-3xl" />
      )}
      <Picture
        img={img}
        sizes={sizes}
        priority={priority}
        className="w-full max-w-md drop-shadow-[0_25px_35px_rgba(28,25,23,0.14)]"
      />
    </div>
  );
}

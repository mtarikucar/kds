import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, ArrowRight } from "lucide-react";
import type { ImgKey } from "../data/images";
import { IMG } from "../data/images";
import { display } from "../theme";
import FramedShot from "./FramedShot";
import MascotFrame from "./MascotFrame";

interface SplitFeatureProps {
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  desc?: ReactNode;
  bullets?: string[];
  image: ImgKey;
  reverse?: boolean;
  cta?: { to: string; label: string };
  note?: string;
  children?: ReactNode;
}

/**
 * Alternating image + copy row. Automatically frames scene images and floats
 * cutout images. `reverse` flips the column order (editorial rhythm down the page).
 */
export default function SplitFeature({
  id,
  eyebrow,
  title,
  desc,
  bullets,
  image,
  reverse,
  cta,
  note,
  children,
}: SplitFeatureProps) {
  const isScene = IMG[image].kind === "scene";
  return (
    <section
      id={id}
      className="mx-auto max-w-6xl scroll-mt-24 px-5 py-14 sm:py-16"
    >
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className={reverse ? "lg:order-2" : ""}>
          {eyebrow && (
            <span className="text-sm font-semibold uppercase tracking-wider text-[#f97316]">
              {eyebrow}
            </span>
          )}
          <h2
            className="mt-2 text-3xl font-semibold tracking-tight text-[#1c1917] sm:text-4xl"
            style={display}
          >
            {title}
          </h2>
          {desc && (
            <p className="mt-4 text-lg leading-relaxed text-[#57534e]">
              {desc}
            </p>
          )}
          {bullets && (
            <ul className="mt-6 space-y-3">
              {bullets.map((b) => (
                <li key={b} className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#fff3e8] text-[#f97316]">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-[#44403c]">{b}</span>
                </li>
              ))}
            </ul>
          )}
          {children}
          {note && <p className="mt-5 text-sm text-[#a8a29e]">{note}</p>}
          {cta && (
            <Link
              to={cta.to}
              className="group mt-7 inline-flex items-center gap-2 rounded-xl border border-[#e3d7c7] bg-white px-5 py-3 text-sm font-semibold text-[#1c1917] transition hover:border-[#f5c9a3] hover:bg-[#fff8f1]"
            >
              {cta.label}
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>
        <div className={reverse ? "lg:order-1" : ""}>
          {isScene ? (
            <FramedShot
              img={image}
              tilt={!reverse}
              sizes="(max-width: 1024px) 90vw, 520px"
            />
          ) : (
            <MascotFrame img={image} sizes="(max-width: 1024px) 80vw, 460px" />
          )}
        </div>
      </div>
    </section>
  );
}

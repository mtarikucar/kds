import type { ReactNode } from "react";
import { display } from "../theme";

interface SectionProps {
  id?: string;
  eyebrow?: string;
  /** Editorial index numeral ("01", "02"…) rendered as an oversized ghost figure. */
  index?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  center?: boolean;
  className?: string;
  children?: ReactNode;
}

/** Standard marketing section wrapper: max-w-6xl, Fraunces heading, scroll offset. */
export default function Section({
  id,
  eyebrow,
  index,
  title,
  subtitle,
  center,
  className = "",
  children,
}: SectionProps) {
  return (
    <section
      id={id}
      className={`relative mx-auto max-w-6xl scroll-mt-24 px-5 py-16 sm:py-20 ${className}`}
    >
      {index && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-2 right-2 select-none text-[7rem] font-semibold leading-none text-[#1c1917]/[0.045] sm:text-[10rem]"
          style={display}
        >
          {index}
        </span>
      )}
      {(eyebrow || title || subtitle) && (
        <div className={`${center ? "mx-auto text-center" : ""} max-w-2xl`}>
          {eyebrow && (
            <span className="text-sm font-semibold uppercase tracking-wider text-[#f97316]">
              {eyebrow}
            </span>
          )}
          {title && (
            <h2
              className="mt-2 text-3xl font-semibold tracking-tight text-[#1c1917] sm:text-4xl"
              style={display}
            >
              {title}
            </h2>
          )}
          {subtitle && (
            <p className="mt-3 text-lg leading-relaxed text-[#57534e]">
              {subtitle}
            </p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

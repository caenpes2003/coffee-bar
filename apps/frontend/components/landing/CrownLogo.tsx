"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/cn";

type CrownLogoProps = {
  className?: string;
  /** Width in px. Height scales with 2:1 aspect. */
  width?: number;
  priority?: boolean;
};

/**
 * Crown Bar 4.90 logo.
 * Attempts /logo.svg first, falls back to inline SVG if the file is missing
 * (during development before the real asset is dropped in).
 *
 * TODO: reemplazar /public/logo.svg con el logo final del bar.
 */
export function CrownLogo({ className, width = 220, priority = false }: CrownLogoProps) {
  const [failed, setFailed] = useState(false);
  const height = Math.round(width / 2);

  if (failed) {
    return (
      <InlineLogo className={className} width={width} />
    );
  }

  return (
    <Image
      src="/logo.svg"
      alt="Crown Bar 4.90"
      width={width}
      height={height}
      priority={priority}
      onError={() => setFailed(true)}
      className={cn("h-auto w-auto select-none", className)}
    />
  );
}

function InlineLogo({ className, width }: { className?: string; width: number }) {
  return (
    <svg
      viewBox="0 0 240 120"
      width={width}
      height={width / 2}
      className={cn("select-none", className)}
      aria-label="Crown Bar 4.90"
      role="img"
    >
      <g stroke="var(--crown-gold)" strokeWidth={2.4} strokeLinejoin="round" fill="none">
        <path
          d="M32 56 L48 30 L66 52 L84 24 L102 52 L120 30 L120 74 L32 74 Z"
          fill="var(--crown-gold)"
          fillOpacity={0.12}
        />
        <circle cx={48} cy={28} r={3} fill="var(--crown-gold)" />
        <circle cx={84} cy={22} r={3} fill="var(--crown-gold)" />
        <circle cx={120} cy={28} r={3} fill="var(--crown-gold)" />
        <line x1={32} y1={82} x2={120} y2={82} strokeWidth={3} />
      </g>
      <text
        x={140}
        y={66}
        fontFamily="var(--font-score), 'Oswald', sans-serif"
        fontWeight={700}
        fontSize={44}
        letterSpacing={2}
        fill="var(--crown-cream)"
      >
        4.90
      </text>
      <text
        x={141}
        y={88}
        fontFamily="var(--font-sans), sans-serif"
        fontSize={10}
        letterSpacing={6}
        fill="var(--crown-gold)"
      >
        CROWN BAR
      </text>
    </svg>
  );
}

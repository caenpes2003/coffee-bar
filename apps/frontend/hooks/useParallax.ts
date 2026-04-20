"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, useGSAP);
}

type ParallaxLayer = {
  selector: string;
  /** Pixels moved across the scroll of the scope element. Positive = scrolls up slower. */
  y: number;
  /** Optional horizontal drift. */
  x?: number;
  /** Optional scale at end of scroll. */
  scale?: number;
};

type UseParallaxOptions = {
  layers: ParallaxLayer[];
  /** Where the effect starts on the screen. Defaults to "top top". */
  start?: string;
  /** Where the effect ends. Defaults to "bottom top". */
  end?: string;
  scrub?: boolean | number;
};

/**
 * Hook to wire multi-layer parallax with GSAP ScrollTrigger scoped to a container.
 * Honors prefers-reduced-motion by skipping animation entirely.
 */
export function useParallax<T extends HTMLElement = HTMLElement>(
  options: UseParallaxOptions,
) {
  const scopeRef = useRef<T | null>(null);
  const { layers, start = "top top", end = "bottom top", scrub = true } = options;

  useGSAP(
    () => {
      if (typeof window === "undefined") return;
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      if (media.matches) return;

      layers.forEach((layer) => {
        gsap.to(layer.selector, {
          yPercent: 0,
          y: layer.y,
          x: layer.x ?? 0,
          scale: layer.scale ?? 1,
          ease: "none",
          scrollTrigger: {
            trigger: scopeRef.current,
            start,
            end,
            scrub,
          },
        });
      });
    },
    { scope: scopeRef, dependencies: [layers, start, end, scrub] },
  );

  return scopeRef;
}

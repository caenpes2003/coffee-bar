"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import useEmblaCarousel from "embla-carousel-react";
import { cn } from "@/lib/cn";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, useGSAP);
}

/**
 * Ambience section — GSAP parallax gallery on desktop,
 * Embla carousel on mobile. No Framer Motion in this file.
 *
 * TODO: reemplazar los placeholders de gradient con imágenes reales
 * del bar (usar next/image una vez estén en /public).
 */

type Tile = {
  id: string;
  label: string;
  gradient: string;
  span: string;
  depth: "near" | "mid" | "far";
};

const TILES: Tile[] = [
  {
    id: "barra",
    label: "La barra",
    gradient:
      "linear-gradient(135deg, rgba(14,42,31,1) 0%, rgba(11,15,20,0.85) 60%), radial-gradient(circle at 30% 20%, rgba(233,185,73,0.55), transparent 50%)",
    span: "md:col-span-5 md:row-span-2",
    depth: "near",
  },
  {
    id: "partido",
    label: "Clásico de domingo",
    gradient:
      "linear-gradient(180deg, rgba(139,38,53,0.25), rgba(11,15,20,0.92)), radial-gradient(circle at 70% 30%, rgba(245,239,226,0.22), transparent 50%)",
    span: "md:col-span-4 md:row-span-1",
    depth: "far",
  },
  {
    id: "cafe",
    label: "Café de especialidad",
    gradient:
      "linear-gradient(135deg, rgba(101,67,33,0.95) 0%, rgba(11,15,20,0.9) 70%), radial-gradient(circle at 40% 70%, rgba(245,239,226,0.32), transparent 55%)",
    span: "md:col-span-3 md:row-span-1",
    depth: "mid",
  },
  {
    id: "jukebox",
    label: "Jukebox social",
    gradient:
      "linear-gradient(225deg, rgba(233,185,73,0.28), rgba(11,15,20,0.95)), radial-gradient(circle at 20% 80%, rgba(233,185,73,0.5), transparent 55%)",
    span: "md:col-span-4 md:row-span-1",
    depth: "mid",
  },
  {
    id: "snacks",
    label: "Snacks de entretiempo",
    gradient:
      "linear-gradient(135deg, rgba(14,42,31,0.9), rgba(11,15,20,0.98)), radial-gradient(circle at 60% 40%, rgba(139,38,53,0.5), transparent 50%)",
    span: "md:col-span-3 md:row-span-1",
    depth: "near",
  },
];

export function Ambience() {
  return (
    <section
      id="ambiente"
      className="relative w-full overflow-hidden bg-crown-midnight px-6 py-24 sm:px-10 md:px-14 md:py-32"
    >
      <header className="mx-auto max-w-7xl">
        <span className="flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.32em] text-crown-gold">
          <span className="h-px w-8 bg-crown-gold" />
          Entras y ya se siente
        </span>
        <h2 className="mt-4 max-w-3xl font-display text-5xl uppercase leading-[0.9] text-crown-cream sm:text-6xl md:text-7xl">
          Estadio íntimo.
          <br />
          Barra artesanal.
        </h2>
        <p className="mt-6 max-w-xl text-sm leading-relaxed text-crown-cream/70 sm:text-base">
          Luz baja, pantallas de partido, maderas oscuras y café recién hecho.
          Un pub para hinchas que también saben de espresso.
        </p>
      </header>

      {/* Desktop: GSAP parallax grid */}
      <AmbienceDesktop />

      {/* Mobile: Embla carousel */}
      <AmbienceMobile />
    </section>
  );
}

function AmbienceDesktop() {
  const scopeRef = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      if (typeof window === "undefined") return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) return;

      const triggerOpts = {
        trigger: scopeRef.current,
        start: "top bottom",
        end: "bottom top",
        scrub: true,
      };

      gsap.to(".crown-depth-far", { y: -80, ease: "none", scrollTrigger: triggerOpts });
      gsap.to(".crown-depth-mid", { y: -40, ease: "none", scrollTrigger: triggerOpts });
      gsap.to(".crown-depth-near", { y: -15, ease: "none", scrollTrigger: triggerOpts });
    },
    { scope: scopeRef },
  );

  return (
    <div
      ref={scopeRef}
      className="relative mx-auto mt-14 hidden max-w-7xl md:block"
    >
      <div className="grid grid-cols-12 gap-4 auto-rows-[180px] lg:gap-5 lg:auto-rows-[220px]">
        {TILES.map((tile) => (
          <div
            key={tile.id}
            className={cn(
              "group relative overflow-hidden rounded-sm border border-crown-chalk",
              `crown-depth-${tile.depth}`,
              tile.span,
            )}
            style={{ background: tile.gradient }}
          >
            <div className="absolute inset-0 crown-grain" />
            <div className="absolute inset-0 bg-linear-to-t from-crown-midnight/90 via-transparent to-transparent" />
            <div className="absolute inset-0 flex flex-col justify-end p-5">
              <span className="font-score text-[10px] uppercase tracking-[0.32em] text-crown-gold">
                ● {tile.depth === "near" ? "Mesa" : tile.depth === "mid" ? "Barra" : "Pantalla"}
              </span>
              <p className="mt-2 font-display text-2xl uppercase leading-tight tracking-tight text-crown-cream">
                {tile.label}
              </p>
            </div>
            <div className="absolute inset-0 border border-transparent transition-colors duration-300 group-hover:border-crown-gold/60" />
          </div>
        ))}
      </div>
    </div>
  );
}

function AmbienceMobile() {
  const [emblaRef] = useEmblaCarousel({ loop: true, align: "start", dragFree: true });

  return (
    <div className="mt-10 md:hidden">
      <div ref={emblaRef} className="overflow-hidden">
        <div className="flex gap-4">
          {TILES.map((tile) => (
            <div
              key={tile.id}
              className="relative h-64 w-[78%] shrink-0 overflow-hidden rounded-sm border border-crown-chalk"
              style={{ background: tile.gradient }}
            >
              <div className="absolute inset-0 crown-grain" />
              <div className="absolute inset-0 bg-linear-to-t from-crown-midnight/90 via-transparent to-transparent" />
              <div className="absolute inset-0 flex flex-col justify-end p-5">
                <span className="font-score text-[10px] uppercase tracking-[0.32em] text-crown-gold">
                  ● {tile.depth === "near" ? "Mesa" : tile.depth === "mid" ? "Barra" : "Pantalla"}
                </span>
                <p className="mt-2 font-display text-2xl uppercase tracking-tight text-crown-cream">
                  {tile.label}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

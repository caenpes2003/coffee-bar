"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { CrownLogo } from "./CrownLogo";
import { NowPlayingScoreboard } from "./NowPlayingScoreboard";
import { cn } from "@/lib/cn";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger, useGSAP);
}

/**
 * Hero — GSAP-only component (per project rule: no Framer Motion here).
 * Three parallax layers: (a) stadium atmosphere + grain, (b) pitch lines,
 * (c) gold spotlight that tracks the cursor.
 */
export function Hero() {
  const scopeRef = useRef<HTMLElement | null>(null);
  const spotlightRef = useRef<HTMLDivElement | null>(null);

  useGSAP(
    () => {
      if (typeof window === "undefined") return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) return;

      const st = {
        trigger: scopeRef.current,
        start: "top top",
        end: "bottom top",
        scrub: true,
      };

      gsap.to(".crown-hero-atmosphere", { y: 120, ease: "none", scrollTrigger: st });
      gsap.to(".crown-hero-pitch", { y: 220, ease: "none", scrollTrigger: st });
      gsap.to(".crown-hero-spotlight", { y: 80, scale: 1.1, ease: "none", scrollTrigger: st });
      gsap.to(".crown-hero-content", { y: -40, opacity: 0.85, ease: "none", scrollTrigger: st });
    },
    { scope: scopeRef },
  );

  // Cursor-tracking spotlight (desktop only, honoring reduced motion).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointer = window.matchMedia("(pointer: fine)").matches;
    if (reduced || !pointer) return;

    const el = spotlightRef.current;
    if (!el) return;

    let rafId = 0;
    let tx = window.innerWidth / 2;
    let ty = window.innerHeight / 2.2;
    let cx = tx;
    let cy = ty;

    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
    };

    const tick = () => {
      cx += (tx - cx) * 0.08;
      cy += (ty - cy) * 0.08;
      el.style.setProperty("--sx", `${cx}px`);
      el.style.setProperty("--sy", `${cy}px`);
      rafId = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    rafId = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <section
      ref={scopeRef}
      className="relative isolate flex min-h-svh w-full flex-col overflow-hidden bg-crown-midnight crown-grain crown-vignette"
      aria-label="Crown Bar 4.90 — jukebox social"
    >
      {/* Brand watermark — centered, ghosted over midnight via screen blend */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-20 flex items-center justify-center"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt=""
          className="w-[min(72vw,620px)] max-w-none select-none opacity-[0.09] mix-blend-screen"
          style={{ filter: "saturate(1.2) contrast(1.1)" }}
          draggable={false}
        />
      </div>

      {/* Layer a: stadium atmosphere */}
      <div className="crown-hero-atmosphere pointer-events-none absolute inset-0 -z-30">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_20%,rgba(14,42,31,0.85)_0%,rgba(11,15,20,1)_55%)]" />
        <div className="absolute inset-x-0 top-0 h-40 bg-[linear-gradient(to_bottom,rgba(233,185,73,0.14),transparent)]" />
        {/* stadium distant lights */}
        <div className="absolute left-1/4 top-[10%] h-40 w-40 rounded-full bg-crown-gold/20 blur-3xl" />
        <div className="absolute right-[18%] top-[18%] h-48 w-48 rounded-full bg-crown-gold/10 blur-3xl" />
      </div>

      {/* Layer b: pitch lines SVG */}
      <svg
        className="crown-hero-pitch pointer-events-none absolute inset-x-0 bottom-[-5%] -z-20 h-[70%] w-full opacity-40"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMax slice"
        aria-hidden
      >
        <defs>
          <linearGradient id="pitchFade" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(245,239,226,0)" />
            <stop offset="40%" stopColor="rgba(245,239,226,0.22)" />
            <stop offset="100%" stopColor="rgba(245,239,226,0.05)" />
          </linearGradient>
        </defs>
        <g stroke="url(#pitchFade)" strokeWidth={1.4} fill="none">
          {/* Center circle */}
          <circle cx="800" cy="520" r="130" />
          <circle cx="800" cy="520" r="3" fill="rgba(245,239,226,0.4)" />
          {/* Halfway line */}
          <line x1="0" y1="520" x2="1600" y2="520" />
          {/* Penalty boxes perspective */}
          <path d="M250 900 L560 620 L1040 620 L1350 900 Z" />
          <path d="M450 900 L660 700 L940 700 L1150 900 Z" />
          {/* Corner arcs */}
          <path d="M0 880 Q 40 880 40 840" />
          <path d="M1600 880 Q 1560 880 1560 840" />
        </g>
      </svg>

      {/* Layer c: cursor spotlight */}
      <div
        ref={spotlightRef}
        className="crown-hero-spotlight pointer-events-none absolute inset-0 -z-10 crown-animate-spotlight"
        style={{
          background:
            "radial-gradient(600px 600px at var(--sx, 50%) var(--sy, 40%), rgba(233,185,73,0.18), transparent 60%)",
        }}
        aria-hidden
      />

      {/* Top nav strip */}
      <header className="relative z-10 flex items-center justify-between px-6 pt-6 sm:px-10 md:px-14">
        <CrownLogo width={140} priority />
        <div className="hidden items-center gap-6 text-[11px] font-medium uppercase tracking-[0.28em] text-crown-cream/70 md:flex">
          <Link href="#como-funciona" className="transition-colors hover:text-crown-gold">
            Cómo funciona
          </Link>
          <Link href="#ambiente" className="transition-colors hover:text-crown-gold">
            Ambiente
          </Link>
          <Link href="#menu" className="transition-colors hover:text-crown-gold">
            Menú
          </Link>
          <Link href="#partidos" className="transition-colors hover:text-crown-gold">
            Partidos
          </Link>
        </div>
        <div className="hidden md:block">
          <NowPlayingScoreboard compact />
        </div>
      </header>

      {/* Main content */}
      <div className="crown-hero-content relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center px-6 py-20 sm:px-10 md:px-14">
        <HeroTagRow />

        <h1
          className={cn(
            "mt-7 max-w-4xl font-display uppercase leading-[0.88] text-crown-cream",
            "text-[clamp(3.25rem,10vw,8.75rem)] tracking-[-0.01em]",
          )}
        >
          La música
          <br />
          la <span className="relative inline-block">
            <span className="relative z-10 text-crown-gold">eliges</span>
            <span className="absolute inset-x-0 bottom-[12%] z-0 h-[38%] bg-crown-ember/70 [clip-path:polygon(2%_30%,98%_0,100%_70%,0_100%)]" />
          </span>{" "}
          tú.
        </h1>

        <p className="mt-6 max-w-xl text-base leading-relaxed text-crown-cream/75 sm:text-lg">
          Crown Bar 4.90 es un pub futbolero y cafetería en donde el jukebox
          vive en las mesas. Escaneas el QR, buscas tu canción, y entra a una
          cola justa para todos. Sin DJ que te ignore, sin playlist aburrida.
        </p>

        <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
          <Link
            href="/mesa"
            className={cn(
              "group relative inline-flex items-center gap-3 overflow-hidden rounded-full px-7 py-4",
              "bg-crown-gold text-crown-midnight font-semibold uppercase tracking-[0.18em] text-sm",
              "shadow-[0_12px_48px_-12px_rgba(233,185,73,0.7)]",
              "transition-all duration-200 ease-out",
              "hover:-translate-y-0.5 hover:shadow-[0_18px_56px_-10px_rgba(233,185,73,0.85)] hover:bg-crown-gold-hot",
              "active:scale-[0.97] active:bg-crown-ember active:text-crown-cream",
            )}
          >
            <span className="relative z-10">Elegir canción desde mi mesa</span>
            <ArrowBall />
            <span className="absolute inset-0 z-0 -translate-x-full bg-linear-to-r from-transparent via-crown-cream/40 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
          </Link>
          <Link
            href="/player"
            className={cn(
              "inline-flex items-center gap-3 rounded-full border border-crown-cream/25 px-6 py-4",
              "text-xs font-medium uppercase tracking-[0.22em] text-crown-cream",
              "transition-colors hover:border-crown-gold hover:text-crown-gold",
            )}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inset-0 rounded-full bg-crown-ember crown-animate-pulse-ring" />
              <span className="relative h-2 w-2 rounded-full bg-crown-ember" />
            </span>
            Ver qué suena ahora
          </Link>
        </div>

        <div className="mt-14 flex items-center gap-6 text-[10px] font-medium uppercase tracking-[0.32em] text-crown-cream/50">
          <span>EST. 2025</span>
          <span className="h-px w-10 bg-crown-cream/30" />
          <span>Pub · Cafetería · Jukebox social</span>
        </div>
      </div>

      {/* Mobile scoreboard */}
      <div className="relative z-10 mx-auto w-full max-w-7xl px-6 pb-8 sm:px-10 md:hidden">
        <NowPlayingScoreboard />
      </div>

      {/* Divider — pitch line */}
      <PitchDivider />
    </section>
  );
}

function HeroTagRow() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[10px] font-medium uppercase tracking-[0.32em] text-crown-cream/60">
      <span className="flex items-center gap-2 rounded-full border border-crown-chalk px-3 py-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-crown-gold" />
        Jukebox social
      </span>
      <span className="flex items-center gap-2 rounded-full border border-crown-chalk px-3 py-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-crown-ember" />
        Partidos en vivo
      </span>
      <span className="hidden items-center gap-2 rounded-full border border-crown-chalk px-3 py-1.5 sm:flex">
        <span className="h-1.5 w-1.5 rounded-full bg-crown-cream" />
        Café de especialidad
      </span>
    </div>
  );
}

function ArrowBall() {
  return (
    <span className="relative z-10 flex h-7 w-7 items-center justify-center rounded-full bg-crown-midnight text-crown-gold transition-transform duration-300 group-hover:rotate-360">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 12h14M13 5l7 7-7 7" />
      </svg>
    </span>
  );
}

function PitchDivider() {
  return (
    <svg
      className="relative z-0 h-15 w-full text-crown-chalk"
      viewBox="0 0 1600 60"
      preserveAspectRatio="none"
      aria-hidden
    >
      <line x1="0" y1="30" x2="700" y2="30" stroke="currentColor" strokeWidth="1" />
      <circle cx="800" cy="30" r="22" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="800" cy="30" r="2" fill="currentColor" />
      <line x1="900" y1="30" x2="1600" y2="30" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

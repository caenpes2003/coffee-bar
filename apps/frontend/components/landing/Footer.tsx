"use client";

import Link from "next/link";
import { MapPin, Clock, Phone } from "lucide-react";
import { CrownLogo } from "./CrownLogo";

export function Footer() {
  return (
    <footer className="relative w-full border-t border-crown-chalk bg-crown-midnight px-6 pt-20 pb-10 sm:px-10 md:px-14">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-14 lg:grid-cols-[1.3fr_1fr_1fr_1fr]">
        {/* Brand column */}
        <div className="flex flex-col gap-6">
          <CrownLogo width={180} />
          <p className="max-w-xs text-sm leading-relaxed text-crown-cream/65">
            Pub, cafetería y jukebox social. Donde la música la pone la mesa y
            el gol lo grita todo el lugar.
          </p>
          <div className="flex items-center gap-3">
            <Link
              href="#"
              aria-label="Instagram"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-crown-cream/20 text-crown-cream transition-all hover:border-crown-gold hover:text-crown-gold"
            >
              <InstagramIcon />
            </Link>
            {/* TODO: agregar Facebook, TikTok cuando existan perfiles reales */}
          </div>
        </div>

        {/* Visit column */}
        <div className="flex flex-col gap-4">
          <h3 className="font-score text-[10px] uppercase tracking-[0.32em] text-crown-gold">
            Visítanos
          </h3>
          <ul className="flex flex-col gap-3 text-sm text-crown-cream/75">
            <li className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-crown-gold" aria-hidden />
              <span>
                {/* TODO: dirección real del bar */}
                Cra. 0 #00-00, Bogotá
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-crown-gold" aria-hidden />
              <span>
                {/* TODO: horarios reales */}
                Mar — Dom · 4:00 pm — 2:00 am
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Phone className="mt-0.5 h-4 w-4 shrink-0 text-crown-gold" aria-hidden />
              <span>
                {/* TODO: teléfono real */}
                +57 300 000 0000
              </span>
            </li>
          </ul>
        </div>

        {/* Nav column */}
        <div className="flex flex-col gap-4">
          <h3 className="font-score text-[10px] uppercase tracking-[0.32em] text-crown-gold">
            Navegar
          </h3>
          <ul className="flex flex-col gap-2 text-sm text-crown-cream/75">
            <li><Link href="#como-funciona" className="transition-colors hover:text-crown-gold">Cómo funciona</Link></li>
            <li><Link href="#ambiente" className="transition-colors hover:text-crown-gold">Ambiente</Link></li>
            <li><Link href="#menu" className="transition-colors hover:text-crown-gold">Menú</Link></li>
            <li><Link href="#partidos" className="transition-colors hover:text-crown-gold">Partidos</Link></li>
            <li><Link href="/player" className="transition-colors hover:text-crown-gold">Player</Link></li>
            <li><Link href="/mesa" className="transition-colors hover:text-crown-gold">Mi mesa</Link></li>
          </ul>
        </div>

        {/* QR column */}
        <div className="flex flex-col gap-4">
          <h3 className="font-score text-[10px] uppercase tracking-[0.32em] text-crown-gold">
            Ya estás aquí
          </h3>
          <div className="relative flex h-36 w-36 items-center justify-center rounded-sm border border-crown-gold/30 bg-crown-pitch/30 p-3">
            <svg viewBox="0 0 100 100" className="h-full w-full text-crown-cream" aria-label="QR a tu mesa">
              <rect x="6" y="6" width="20" height="20" fill="currentColor" />
              <rect x="74" y="6" width="20" height="20" fill="currentColor" />
              <rect x="6" y="74" width="20" height="20" fill="currentColor" />
              <rect x="10" y="10" width="12" height="12" fill="var(--crown-midnight)" />
              <rect x="78" y="10" width="12" height="12" fill="var(--crown-midnight)" />
              <rect x="10" y="78" width="12" height="12" fill="var(--crown-midnight)" />
              <rect x="14" y="14" width="4" height="4" fill="currentColor" />
              <rect x="82" y="14" width="4" height="4" fill="currentColor" />
              <rect x="14" y="82" width="4" height="4" fill="currentColor" />
              {/* Data dots — decorative, not scannable */}
              {Array.from({ length: 52 }).map((_, i) => {
                const x = 32 + (i % 10) * 4;
                const y = 32 + Math.floor(i / 10) * 4;
                const on = (i * 37) % 7 < 4;
                return on ? <rect key={i} x={x} y={y} width="3" height="3" fill="currentColor" /> : null;
              })}
            </svg>
            <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-crown-midnight px-2 font-score text-[9px] uppercase tracking-[0.28em] text-crown-gold">
              Decorativo
            </span>
          </div>
          <p className="text-xs leading-relaxed text-crown-cream/55">
            El QR real vive en cada mesa. Acércate, escanea y elige tu canción.
          </p>
        </div>
      </div>

      <div className="mx-auto mt-16 flex max-w-7xl flex-col items-start justify-between gap-3 border-t border-crown-chalk pt-6 text-[10px] uppercase tracking-[0.28em] text-crown-cream/45 sm:flex-row sm:items-center">
        <span>© 2025 Crown Bar 4.90 — Todos los derechos reservados</span>
        <span className="font-score">Built with love for football &amp; coffee.</span>
      </div>
    </footer>
  );
}

function InstagramIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

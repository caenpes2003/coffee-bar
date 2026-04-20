"use client";

import { motion } from "framer-motion";
import useEmblaCarousel from "embla-carousel-react";
import { useReveal, revealVariants } from "@/hooks/useReveal";
import { cn } from "@/lib/cn";

// TODO: reemplazar con datos reales del bar (calendario curado manualmente
// o fetch a un backend).
const FIXTURES = [
  { home: "RMA", away: "BAR", league: "La Liga", date: "Sab 21 Abr", time: "14:00", hot: true },
  { home: "MAN", away: "LIV", league: "Premier", date: "Dom 22 Abr", time: "11:30", hot: false },
  { home: "COL", away: "ARG", league: "Eliminatorias", date: "Jue 26 Abr", time: "18:30", hot: true },
  { home: "PSG", away: "MCI", league: "Champions", date: "Mar 1 May", time: "14:00", hot: false },
  { home: "JUV", away: "INT", league: "Serie A", date: "Sab 5 May", time: "13:45", hot: false },
];

export function Matches() {
  const { ref, inView } = useReveal();
  const [emblaRef] = useEmblaCarousel({ loop: false, align: "start", dragFree: true });

  return (
    <section
      id="partidos"
      ref={ref}
      className="relative w-full overflow-hidden border-y border-crown-chalk bg-crown-pitch/40 py-16 md:py-20"
    >
      <div className="pointer-events-none absolute inset-0 crown-pitch-lines opacity-30" aria-hidden />

      <motion.header
        initial="hidden"
        animate={inView ? "visible" : "hidden"}
        variants={revealVariants}
        className="relative mx-auto mb-10 flex max-w-7xl flex-col items-start justify-between gap-4 px-6 sm:px-10 md:flex-row md:items-end md:px-14"
      >
        <div>
          <span className="flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.32em] text-crown-gold">
            <span className="h-px w-8 bg-crown-gold" />
            Pizarrón del estadio
          </span>
          <h2 className="mt-4 font-display text-4xl uppercase leading-[0.95] text-crown-cream sm:text-5xl md:text-6xl">
            Próximos partidos
          </h2>
        </div>
        <p className="max-w-sm text-sm text-crown-cream/65">
          Las mejores ligas en pantalla grande. Reserva tu mesa los días de
          clásico — se llena rápido.
        </p>
      </motion.header>

      {/* Ticker-style scrolling band + carousel fallback on mobile */}
      <div ref={emblaRef} className="relative overflow-hidden md:hidden">
        <div className="flex gap-3 px-6 pb-2">
          {FIXTURES.map((f, i) => (
            <FixtureCard key={i} fixture={f} />
          ))}
        </div>
      </div>

      <div className="relative hidden overflow-hidden md:block">
        <div className="flex w-max gap-4 px-6 crown-animate-ticker sm:px-10 md:px-14">
          {[...FIXTURES, ...FIXTURES].map((f, i) => (
            <FixtureCard key={i} fixture={f} />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-linear-to-r from-crown-midnight to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-linear-to-l from-crown-midnight to-transparent" />
      </div>
    </section>
  );
}

type Fixture = {
  home: string;
  away: string;
  league: string;
  date: string;
  time: string;
  hot: boolean;
};

function FixtureCard({ fixture }: { fixture: Fixture }) {
  return (
    <article
      className={cn(
        "relative flex h-37 w-70 shrink-0 flex-col justify-between overflow-hidden rounded-sm border bg-crown-midnight/70 p-5 backdrop-blur-sm",
        fixture.hot ? "border-crown-gold/70" : "border-crown-chalk",
      )}
    >
      {fixture.hot && (
        <span className="absolute right-3 top-3 rounded-sm bg-crown-ember/90 px-2 py-0.5 font-score text-[10px] uppercase tracking-[0.22em] text-crown-cream">
          ● Hot
        </span>
      )}
      <span className="font-score text-[10px] uppercase tracking-[0.32em] text-crown-cream/60">
        {fixture.league}
      </span>
      <div className="flex items-center gap-3">
        <TeamBadge code={fixture.home} />
        <span className="font-display text-lg uppercase tracking-tight text-crown-gold">VS</span>
        <TeamBadge code={fixture.away} />
      </div>
      <div className="flex items-center justify-between border-t border-crown-chalk pt-2 font-score text-xs uppercase tracking-[0.2em] text-crown-cream/70">
        <span>{fixture.date}</span>
        <span className="text-crown-gold">{fixture.time}</span>
      </div>
    </article>
  );
}

function TeamBadge({ code }: { code: string }) {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-crown-cream/25 bg-crown-pitch/60 font-display text-sm uppercase tracking-tight text-crown-cream">
      {code}
    </div>
  );
}

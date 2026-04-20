"use client";

import { motion } from "framer-motion";
import { Disc3, Users } from "lucide-react";
import { useReveal, revealVariants, staggerContainer, staggerChild } from "@/hooks/useReveal";
import { cn } from "@/lib/cn";

// TODO: conectar a socket.io-client para now-playing + cola en vivo.
const MOCK_NOW = {
  title: "Mr. Brightside",
  artist: "The Killers",
  album: "Hot Fuss",
  progress: 0.62,
  durationLabel: "3:42",
  currentLabel: "2:17",
  mesa: "Mesa 7",
};

const MOCK_QUEUE = [
  { title: "Wonderwall", artist: "Oasis", mesa: "Mesa 3", eta: "en 1" },
  { title: "Dreams", artist: "Fleetwood Mac", mesa: "Mesa 12", eta: "en 2" },
  { title: "Superstition", artist: "Stevie Wonder", mesa: "Mesa 4", eta: "en 3" },
];

export function NowPlayingPreview() {
  const { ref, inView } = useReveal();

  return (
    <section
      ref={ref}
      className="relative w-full overflow-hidden bg-crown-pitch/35 px-6 py-24 sm:px-10 md:px-14 md:py-32"
    >
      <div className="pointer-events-none absolute inset-0 crown-pitch-lines opacity-40" aria-hidden />

      <motion.div
        initial="hidden"
        animate={inView ? "visible" : "hidden"}
        variants={staggerContainer}
        className="relative mx-auto grid max-w-7xl grid-cols-1 gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-16"
      >
        {/* NOW PLAYING card */}
        <motion.article
          variants={revealVariants}
          className="crown-corner-tick relative flex flex-col gap-7 border border-crown-gold/25 bg-crown-midnight/60 p-6 backdrop-blur-sm sm:p-8 md:p-10"
        >
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.32em] text-crown-gold">
              <span className="h-2 w-2 rounded-full bg-crown-ember crown-animate-blink" />
              En vivo · Ahora mismo
            </span>
            <span className="font-score text-xs uppercase tracking-[0.2em] text-crown-cream/60">
              {MOCK_NOW.mesa}
            </span>
          </div>

          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            <ArtworkTile />
            <div className="min-w-0 flex-1">
              <p className="font-display text-[clamp(2.25rem,5vw,3.5rem)] uppercase leading-[0.9] text-crown-cream">
                {MOCK_NOW.title}
              </p>
              <p className="mt-2 font-score text-sm uppercase tracking-[0.22em] text-crown-cream/70">
                {MOCK_NOW.artist} · <span className="text-crown-cream/50">{MOCK_NOW.album}</span>
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="flex flex-col gap-2">
            <div className="relative h-0.75 w-full overflow-hidden bg-crown-cream/15">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={inView ? { scaleX: MOCK_NOW.progress } : { scaleX: 0 }}
                transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
                style={{ transformOrigin: "left" }}
                className="absolute inset-y-0 left-0 w-full bg-linear-to-r from-crown-gold to-crown-gold-hot"
              />
              <motion.span
                initial={{ left: "0%" }}
                animate={inView ? { left: `${MOCK_NOW.progress * 100}%` } : { left: "0%" }}
                transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
                className="absolute top-1/2 -mt-1.25 -ml-1.25 h-2.75 w-2.75 rounded-full bg-crown-cream shadow-[0_0_0_3px_rgba(233,185,73,0.25)]"
                aria-hidden
              />
            </div>
            <div className="flex items-center justify-between font-score text-[11px] tracking-[0.18em] text-crown-cream/60">
              <span>{MOCK_NOW.currentLabel}</span>
              <span>{MOCK_NOW.durationLabel}</span>
            </div>
          </div>
        </motion.article>

        {/* QUEUE preview */}
        <motion.aside variants={revealVariants} className="flex flex-col gap-5">
          <div className="flex items-center justify-between border-b border-crown-chalk pb-3">
            <span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.32em] text-crown-cream/70">
              <Users className="h-3.5 w-3.5 text-crown-gold" aria-hidden />
              Siguientes en la cola
            </span>
            <span className="font-score text-xs uppercase tracking-[0.2em] text-crown-gold">
              Fair-play
            </span>
          </div>

          <motion.ol variants={staggerContainer} className="flex flex-col gap-3">
            {MOCK_QUEUE.map((track, idx) => (
              <motion.li
                key={track.title}
                variants={staggerChild}
                className={cn(
                  "group flex items-center gap-4 border-b border-crown-chalk py-3",
                  "transition-colors hover:border-crown-gold/50",
                )}
              >
                <span className="font-score text-2xl font-semibold tabular-nums text-crown-gold/80 w-8">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-xl uppercase tracking-tight text-crown-cream">
                    {track.title}
                  </p>
                  <p className="truncate text-xs text-crown-cream/55">
                    {track.artist} · <span className="text-crown-gold/70">{track.mesa}</span>
                  </p>
                </div>
                <span className="hidden shrink-0 font-score text-[10px] uppercase tracking-[0.22em] text-crown-cream/60 sm:inline">
                  {track.eta}
                </span>
              </motion.li>
            ))}
          </motion.ol>
        </motion.aside>
      </motion.div>
    </section>
  );
}

function ArtworkTile() {
  return (
    <div
      className="relative h-32 w-32 shrink-0 overflow-hidden rounded-sm bg-crown-midnight sm:h-36 sm:w-36"
      aria-hidden
    >
      <div className="absolute inset-0 bg-[conic-gradient(from_210deg,rgba(139,38,53,0.85),rgba(233,185,73,0.7),rgba(14,42,31,0.9),rgba(139,38,53,0.85))]" />
      <div className="absolute inset-3 rounded-sm border border-crown-cream/15" />
      <div className="absolute inset-0 flex items-center justify-center">
        <Disc3 className="h-14 w-14 text-crown-cream/85" strokeWidth={1.2} />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-crown-midnight to-transparent" />
    </div>
  );
}

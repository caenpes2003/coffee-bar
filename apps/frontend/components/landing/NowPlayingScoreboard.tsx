"use client";

import { motion } from "framer-motion";
import { Music2 } from "lucide-react";
import { cn } from "@/lib/cn";

// TODO: conectar a socket.io-client para datos reales de "now playing".
const MOCK_TRACK = {
  title: "Blinding Lights",
  artist: "The Weeknd",
};

/**
 * Floating scoreboard chip shown in the hero.
 * Uses Framer Motion (not GSAP) — separate component from Hero to respect
 * the project rule of not mixing both libraries in a single file.
 */
export function NowPlayingScoreboard({ compact = false }: { compact?: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "relative inline-flex items-center gap-3 rounded-sm border border-crown-gold/40 bg-crown-midnight/70 px-3.5 py-2 backdrop-blur-sm",
        compact ? "" : "w-full max-w-sm",
      )}
      aria-live="polite"
      aria-label="Reproduciendo ahora"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-crown-gold/15 text-crown-gold">
        <Music2 className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-[9px] font-semibold uppercase tracking-[0.32em] text-crown-gold crown-animate-blink">
          ● Now playing
        </span>
        <motion.span
          key={MOCK_TRACK.title}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "truncate font-score text-sm uppercase tracking-[0.14em] text-crown-cream",
            compact ? "max-w-[180px]" : "max-w-full",
          )}
        >
          {MOCK_TRACK.title}
          <span className="ml-2 text-crown-cream/55">— {MOCK_TRACK.artist}</span>
        </motion.span>
      </div>
    </motion.div>
  );
}

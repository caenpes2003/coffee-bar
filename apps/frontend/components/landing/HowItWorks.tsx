"use client";

import { motion } from "framer-motion";
import { QrCode, Search, ListMusic } from "lucide-react";
import { useReveal, revealVariants, staggerContainer, staggerChild } from "@/hooks/useReveal";
import { cn } from "@/lib/cn";

const STEPS = [
  {
    number: "01",
    icon: QrCode,
    title: "Escanea el QR",
    body: "Cada mesa tiene su propio QR. Lo escaneas y entras directo a tu sala privada — sin descargar nada.",
  },
  {
    number: "02",
    icon: Search,
    title: "Busca tu canción",
    body: "Buscador híbrido: Spotify, YouTube, o lo que sea. Ves la cola en vivo y cuántas canciones te faltan.",
  },
  {
    number: "03",
    icon: ListMusic,
    title: "Cola justa para todos",
    body: "Nuestro algoritmo intercala canciones por mesa, no por quién llegó primero. Nadie monopoliza la noche.",
  },
];

export function HowItWorks() {
  const { ref, inView } = useReveal();

  return (
    <section
      id="como-funciona"
      ref={ref}
      className="relative w-full bg-crown-midnight px-6 py-24 sm:px-10 md:px-14 md:py-32"
    >
      <motion.div
        initial="hidden"
        animate={inView ? "visible" : "hidden"}
        variants={staggerContainer}
        className="mx-auto max-w-7xl"
      >
        <motion.div variants={revealVariants} className="flex flex-col items-start gap-4">
          <span className="flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.32em] text-crown-gold">
            <span className="h-px w-8 bg-crown-gold" />
            Jugada en tres toques
          </span>
          <h2 className="max-w-2xl font-display text-5xl uppercase leading-[0.9] text-crown-cream sm:text-6xl md:text-7xl">
            Desde la mesa
            <br />
            hasta el <span className="text-crown-gold">altavoz</span>
          </h2>
        </motion.div>

        <motion.ol
          variants={staggerContainer}
          className="mt-16 grid grid-cols-1 gap-8 md:mt-20 md:grid-cols-3 md:gap-6 lg:gap-10"
        >
          {STEPS.map((step, idx) => (
            <motion.li
              key={step.number}
              variants={staggerChild}
              className={cn(
                "group relative flex flex-col gap-6 border-t border-crown-chalk pt-8",
                "md:border-l md:border-t-0 md:pl-8 md:pt-0",
                idx === 0 && "md:border-l-0 md:pl-0",
              )}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-score text-6xl font-semibold tracking-tight text-crown-gold/90 tabular-nums">
                  {step.number}
                </span>
                <span
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-full border border-crown-cream/20",
                    "bg-crown-pitch/40 text-crown-cream transition-all duration-300",
                    "group-hover:border-crown-gold group-hover:text-crown-gold group-hover:-rotate-6",
                  )}
                >
                  <step.icon className="h-5 w-5" aria-hidden />
                </span>
              </div>
              <div>
                <h3 className="font-display text-2xl uppercase tracking-tight text-crown-cream">
                  {step.title}
                </h3>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-crown-cream/70">
                  {step.body}
                </p>
              </div>
              {/* Connector on desktop, between items */}
              {idx < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className="absolute right-[-20px] top-10 hidden h-px w-10 bg-gradient-to-r from-crown-gold/60 to-transparent md:block lg:w-16 lg:right-[-32px]"
                />
              )}
            </motion.li>
          ))}
        </motion.ol>
      </motion.div>
    </section>
  );
}

"use client";

import { motion } from "framer-motion";
import { Coffee, Beer, Flame, Sandwich } from "lucide-react";
import { useReveal, revealVariants, staggerContainer, staggerChild } from "@/hooks/useReveal";

const ITEMS = [
  {
    icon: Coffee,
    kind: "Cafetería",
    name: "Flat white Huila",
    description: "Granos de finca colombiana, lechera micro-foam, doble shot.",
    price: "9.000",
  },
  {
    icon: Beer,
    kind: "Coctelería",
    name: "Crown Negroni",
    description: "Campari, vermouth rojo, ginebra artesanal, twist de naranja.",
    price: "22.000",
  },
  {
    icon: Flame,
    kind: "Parrilla",
    name: "Alitas 4.90",
    description: "Media docena, salsa de la casa, papa rústica. Picante a elección.",
    price: "26.000",
  },
  {
    icon: Sandwich,
    kind: "Snack",
    name: "Nachos de entretiempo",
    description: "Queso fundido, guacamole fresco, pico de gallo, carne desmechada.",
    price: "24.000",
  },
];

export function Menu() {
  const { ref, inView } = useReveal();

  return (
    <section
      id="menu"
      ref={ref}
      className="relative w-full bg-crown-midnight px-6 py-24 sm:px-10 md:px-14 md:py-32"
    >
      <motion.div
        initial="hidden"
        animate={inView ? "visible" : "hidden"}
        variants={staggerContainer}
        className="mx-auto max-w-7xl"
      >
        <motion.header
          variants={revealVariants}
          className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end"
        >
          <div>
            <span className="flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.32em] text-crown-gold">
              <span className="h-px w-8 bg-crown-gold" />
              La carta — destacados
            </span>
            <h2 className="mt-4 max-w-3xl font-display text-5xl uppercase leading-[0.9] text-crown-cream sm:text-6xl md:text-7xl">
              Café que despierta.
              <br />
              Tragos que anotan.
            </h2>
          </div>
          <p className="max-w-sm text-sm text-crown-cream/65">
            Carta rotativa cada temporada. Ingredientes locales, recetas de
            barra clásica, cocina de pub honesta.
          </p>
        </motion.header>

        <motion.ul variants={staggerContainer} className="mt-14 grid grid-cols-1 gap-0 md:grid-cols-2 md:gap-x-14 md:gap-y-2">
          {ITEMS.map((item, idx) => (
            <motion.li
              key={item.name}
              variants={staggerChild}
              className="group flex items-start gap-5 border-b border-dashed border-crown-chalk py-7 first:border-t md:py-8"
            >
              <span className="mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-crown-cream/20 bg-crown-pitch/40 text-crown-gold transition-all duration-300 group-hover:border-crown-gold group-hover:rotate-3">
                <item.icon className="h-4 w-4" aria-hidden />
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-score text-[10px] uppercase tracking-[0.32em] text-crown-gold/80">
                  {item.kind}
                </span>
                <div className="mt-1 flex items-baseline justify-between gap-4">
                  <h3 className="font-display text-2xl uppercase tracking-tight text-crown-cream sm:text-3xl">
                    {item.name}
                  </h3>
                  <span className="shrink-0 font-score text-lg tabular-nums text-crown-gold">
                    ${item.price}
                  </span>
                </div>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-crown-cream/65">
                  {item.description}
                </p>
              </div>
              <span className="ml-auto hidden font-score text-5xl font-semibold tabular-nums text-crown-cream/10 md:block">
                {String(idx + 1).padStart(2, "0")}
              </span>
            </motion.li>
          ))}
        </motion.ul>

        <motion.p variants={revealVariants} className="mt-10 text-xs uppercase tracking-[0.28em] text-crown-cream/50">
          — Carta completa disponible en la mesa
        </motion.p>
      </motion.div>
    </section>
  );
}

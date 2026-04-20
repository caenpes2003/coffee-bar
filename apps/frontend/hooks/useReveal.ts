"use client";

import { useInView } from "react-intersection-observer";
import type { Variants } from "framer-motion";

type UseRevealOptions = {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
};

/**
 * Hook returning `{ ref, inView }` + a set of ready-to-use motion variants.
 * Pair with `<motion.div initial="hidden" animate={inView ? "visible" : "hidden"} variants={...}>`.
 */
export function useReveal(options: UseRevealOptions = {}) {
  const { threshold = 0.2, rootMargin = "0px 0px -10% 0px", once = true } = options;
  const { ref, inView } = useInView({ threshold, rootMargin, triggerOnce: once });
  return { ref, inView };
}

export const revealVariants: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.12, delayChildren: 0.05 },
  },
};

export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 22 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] },
  },
};

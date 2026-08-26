"use client";

import { useEffect, useRef, useState } from "react";
import {
  animate,
  motion,
  useInView,
  useReducedMotion,
  type HTMLMotionProps,
} from "motion/react";

import { cn } from "@/lib/utils";
import { fadeInUp, staggerContainer } from "./variants";

type FadeInProps = HTMLMotionProps<"div"> & {
  delay?: number;
  as?: "div" | "section" | "span";
};

/** Fade + rise on mount. Respects prefers-reduced-motion. */
export function FadeIn({ delay = 0, className, ...props }: FadeInProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? undefined : "hidden"}
      animate="visible"
      variants={fadeInUp}
      transition={{ delay }}
      className={className}
      {...props}
    />
  );
}

type StaggerProps = HTMLMotionProps<"div"> & {
  stagger?: number;
  delay?: number;
};

/** Staggers direct StaggerItem children into view. */
export function Stagger({
  stagger = 0.08,
  delay = 0,
  className,
  ...props
}: StaggerProps) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? undefined : "hidden"}
      whileInView="visible"
      viewport={{ once: true, margin: "-40px" }}
      variants={staggerContainer(stagger, delay)}
      className={className}
      {...props}
    />
  );
}

/** Child of Stagger — inherits the stagger timing. */
export function StaggerItem({
  className,
  ...props
}: HTMLMotionProps<"div">) {
  return (
    <motion.div variants={fadeInUp} className={className} {...props} />
  );
}

type AnimatedCounterProps = {
  value: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
};

/** Counts up to `value` once scrolled into view. */
export function AnimatedCounter({
  value,
  duration = 1.2,
  format = (n) => Math.round(n).toLocaleString(),
  className,
}: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20px" });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(() => format(reduce ? value : 0));
  const currentValueRef = useRef(reduce ? value : 0);

  // `format` defaults to a fresh closure every render, so listing it as an
  // effect dependency restarted (and re-rendered) the animation forever.
  // Route it through a ref instead — synced outside the animation effect.
  const formatRef = useRef(format);
  useEffect(() => {
    formatRef.current = format;
    // Reformat the current value when format changes.
    setDisplay(formatRef.current(currentValueRef.current));
  }, [format]);

  useEffect(() => {
    if (!inView || reduce) return;
    const controls = animate(0, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        currentValueRef.current = v;
        setDisplay(formatRef.current(v));
      },
    });
    return () => controls.stop();
  }, [inView, value, duration, reduce]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {display}
    </span>
  );
}

import { ArrowRight } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button-variants';
import { Badge } from '@/components/ui/badge';
import { ModelRace } from './model-race';

const ease = [0.22, 1, 0.36, 1] as const;

export function Hero() {
  const reducedMotion = useReducedMotion() ?? false;
  // The headline only slides (never fades from 0) so it counts as painted for LCP.
  const rise = (delay: number, fade = true) =>
    reducedMotion
      ? {}
      : {
          initial: { y: 14, ...(fade ? { opacity: 0 } : {}) },
          animate: { y: 0, ...(fade ? { opacity: 1 } : {}) },
          transition: { duration: 0.6, delay, ease },
        };

  return (
    <section className="relative overflow-hidden">
      <div aria-hidden="true" className="hero-grid pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="hero-glow pointer-events-none absolute inset-0" />

      <div className="relative mx-auto max-w-6xl px-5 pt-16 pb-20 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <motion.div {...rise(0)}>
            <Badge tone="primary">Chat · Compare · Analyze</Badge>
          </motion.div>

          <motion.h1
            {...rise(0.05, false)}
            className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-6xl"
          >
            Put AI models <span className="text-primary">in the ring.</span>
          </motion.h1>

          <motion.p
            {...rise(0.12)}
            className="mx-auto mt-5 max-w-2xl text-base text-pretty text-muted-foreground sm:text-lg"
          >
            A.ai sends one prompt to several models at once, streams every answer side by side, and
            shows the latency, tokens and cost behind each one.
          </motion.p>

          <motion.div
            {...rise(0.2)}
            className="mt-8 flex flex-wrap items-center justify-center gap-3"
          >
            <Link to="/chat" className={buttonVariants({ size: 'lg' })}>
              Start chatting
              <ArrowRight />
            </Link>
            <a
              href="#how-it-works"
              className={buttonVariants({ variant: 'secondary', size: 'lg' })}
            >
              See how it works
            </a>
          </motion.div>
        </div>

        <motion.div
          {...(reducedMotion
            ? {}
            : {
                initial: { opacity: 0, y: 24 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.8, delay: 0.3, ease },
              })}
          className="mt-14"
        >
          <ModelRace />
        </motion.div>
      </div>
    </section>
  );
}

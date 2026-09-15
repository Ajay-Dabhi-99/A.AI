import {
  Columns2,
  Gauge,
  History,
  Image as ImageIcon,
  Layers,
  ShieldCheck,
  UserRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';

type Feature = { icon: LucideIcon; title: string; body: string };

const FEATURES: Feature[] = [
  {
    icon: Columns2,
    title: 'Side-by-side comparison',
    body: 'Run the same prompt across up to four models in parallel and read the answers next to each other.',
  },
  {
    icon: Zap,
    title: 'Live token streaming',
    body: 'Watch every response arrive token by token instead of waiting for the slowest model to finish.',
  },
  {
    icon: Gauge,
    title: 'Latency, tokens and cost',
    body: 'Every run records time to first token, total latency and token usage, with estimates clearly labelled.',
  },
  {
    icon: ShieldCheck,
    title: 'Resilient by design',
    body: 'A model that times out or hits a rate limit shows its own error card. The others keep running.',
  },
  {
    icon: UserRound,
    title: 'Try it as a guest',
    body: 'Start without an account under a fair daily limit. Sign up to keep your history and raise the limit.',
  },
  {
    icon: History,
    title: 'History and usage dashboard',
    body: 'Search, rename and reopen past chats and comparisons, and track your runs, tokens, latency and cost over time.',
  },
  {
    icon: ImageIcon,
    title: 'Images and voice',
    body: 'Attach images for models that can see them, dictate a message, and have any answer read aloud.',
  },
  {
    icon: Layers,
    title: 'Provider-agnostic',
    body: 'OpenRouter, Gemini and Groq sit behind one interface, so new models plug in without changing the app.',
  },
];

export function FeatureGrid() {
  const reducedMotion = useReducedMotion() ?? false;

  return (
    <section id="features" className="scroll-mt-20 border-t border-border">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <div className="max-w-2xl">
          <p className="font-mono text-xs tracking-widest text-primary uppercase">Features</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Everything you need to pick the right model
          </h2>
        </div>

        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }, index) => (
            <motion.li
              key={title}
              {...(reducedMotion
                ? {}
                : {
                    initial: { opacity: 0, y: 16 },
                    whileInView: { opacity: 1, y: 0 },
                    viewport: { once: true, margin: '0px 0px -8% 0px' },
                    transition: { duration: 0.5, delay: index * 0.05 },
                  })}
              className="rounded-2xl border border-border bg-surface p-6 transition-colors duration-200 hover:border-primary/40"
            >
              <span className="inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-4 font-medium">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
            </motion.li>
          ))}
        </ul>
      </div>
    </section>
  );
}

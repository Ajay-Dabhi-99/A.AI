const STEPS = [
  {
    title: 'Write one prompt',
    body: 'Ask the question you actually care about: a support reply, a SQL query, a product description.',
  },
  {
    title: 'Pick your contenders',
    body: 'Choose the models to compare. Each one runs in parallel with its own timeout.',
  },
  {
    title: 'Compare the results',
    body: 'Read the answers side by side and decide with real latency and token numbers in front of you.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-20 border-t border-border bg-surface-muted/40">
      <div className="mx-auto max-w-6xl px-5 py-20">
        <p className="font-mono text-xs tracking-widest text-primary uppercase">How it works</p>
        <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Three steps from question to decision
        </h2>

        <ol className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="relative rounded-2xl border border-border bg-surface p-6"
            >
              <span className="font-mono text-sm text-primary tabular-nums">0{index + 1}</span>
              <h3 className="mt-3 text-lg font-medium">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

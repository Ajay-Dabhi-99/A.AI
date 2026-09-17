import { Sparkles } from 'lucide-react';

export function SiteFooter() {
  return (
    <footer className="footer-aurora relative h-[30px]">
      <div className="mx-auto flex h-full max-w-6xl items-center justify-between gap-3 px-4 text-[11px] text-muted-foreground sm:gap-4 sm:px-5 sm:text-xs">
        <p className="truncate">
          © {new Date().getFullYear()} <span className="gradient-flow font-semibold">A.ai</span>.
          {/* Phones keep the short form so both sides fit on one line. */}
          <span className="hidden sm:inline"> All rights reserved.</span>
        </p>
        <p className="flex shrink-0 items-center gap-1.5">
          <Sparkles className="footer-sparkle size-3.5" aria-hidden="true" />
          Developed by <span className="gradient-flow font-semibold">Ajay Dabhi</span>
        </p>
      </div>
    </footer>
  );
}

import { ApiStatusPill } from './api-status-pill';
import { Logo } from './logo';

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Logo className="text-foreground" />
          <span>© {new Date().getFullYear()} A.ai</span>
        </div>
        <ApiStatusPill />
      </div>
    </footer>
  );
}

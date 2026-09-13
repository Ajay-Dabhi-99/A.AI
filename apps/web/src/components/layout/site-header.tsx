import { Link } from 'react-router';
import { ApiStatusPill } from './api-status-pill';
import { HeaderAccount } from './header-account';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5">
        <Link to="/" aria-label="A.ai home" className="rounded-md">
          <Logo />
        </Link>

        <nav
          aria-label="Primary"
          className="hidden items-center gap-7 text-sm text-muted-foreground md:flex"
        >
          <Link to="/#features" className="transition-colors hover:text-foreground">
            Features
          </Link>
          <Link to="/#how-it-works" className="transition-colors hover:text-foreground">
            How it works
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <ApiStatusPill className="hidden lg:inline-flex" />
          <ThemeToggle />
          <HeaderAccount />
        </div>
      </div>
    </header>
  );
}

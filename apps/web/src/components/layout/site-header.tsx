import { Menu } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { Dialog, DialogTrigger, SheetContent } from '@/components/ui/dialog';
import { currentUser, useMe } from '@/hooks/use-me';
import { cn } from '@/lib/utils';
import { ApiStatusPill } from './api-status-pill';
import { HeaderAccount } from './header-account';
import { Logo } from './logo';
import { ThemeToggle } from './theme-toggle';

type NavItem = {
  to: string;
  label: string;
  isActive: (pathname: string, hash: string) => boolean;
  /** History and the dashboard need an account, so guests are not offered them. */
  signedInOnly?: boolean;
  /** In-page links give way on medium screens. */
  wideOnly?: boolean;
};

const under = (prefix: string) => (pathname: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

const NAV: NavItem[] = [
  { to: '/chat', label: 'Chat', isActive: under('/chat') },
  { to: '/compare', label: 'Compare', isActive: under('/compare') },
  { to: '/models', label: 'Models', isActive: under('/models') },
  { to: '/history', label: 'History', isActive: under('/history'), signedInOnly: true },
  { to: '/dashboard', label: 'Dashboard', isActive: under('/dashboard'), signedInOnly: true },
  {
    to: '/#features',
    label: 'Features',
    isActive: (pathname, hash) => pathname === '/' && hash === '#features',
    wideOnly: true,
  },
  {
    to: '/#how-it-works',
    label: 'How it works',
    isActive: (pathname, hash) => pathname === '/' && hash === '#how-it-works',
    wideOnly: true,
  },
];

/** Small screens: the same links in a panel that slides in from the right. */
function MobileNav({
  items,
  isCurrent,
}: {
  items: NavItem[];
  isCurrent: (item: NavItem) => boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        aria-label="Open menu"
        className="inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-surface-muted hover:text-foreground lg:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </DialogTrigger>
      <SheetContent side="right" title="Menu">
        <nav aria-label="Mobile" className="flex flex-col gap-1">
          {items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-current={isCurrent(item) ? 'page' : undefined}
              onClick={() => setOpen(false)}
              className="mobile-nav-link"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-border pt-3">
          <ApiStatusPill />
        </div>
      </SheetContent>
    </Dialog>
  );
}

export function SiteHeader() {
  const signedIn = currentUser(useMe().data) !== null;
  const { pathname, hash } = useLocation();
  const items = NAV.filter((item) => signedIn || !item.signedInOnly);
  const isCurrent = (item: NavItem) => item.isActive(pathname, hash);

  return (
    <header className="site-header sticky top-0 z-40">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-5 md:gap-6">
        <Link to="/" aria-label="A.ai home" className="shrink-0 rounded-md">
          <Logo />
        </Link>

        {/* Active state is plain CSS on aria-current: nothing is measured or animated on navigation. */}
        <nav aria-label="Primary" className="hidden h-full items-center gap-1 text-sm md:flex">
          {items.map((item) => {
            const current = isCurrent(item);
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={current ? 'page' : undefined}
                className={cn('nav-link', item.wideOnly && 'hidden lg:inline-flex')}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ApiStatusPill className="hidden xl:inline-flex" />
          <ThemeToggle />
          <HeaderAccount />
          <MobileNav items={items} isCurrent={isCurrent} />
        </div>
      </div>
    </header>
  );
}

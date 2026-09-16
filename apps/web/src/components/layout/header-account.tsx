import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button-variants';
import { displayName, initials } from '@/features/profile/identity';
import { currentUser, useMe } from '@/hooks/use-me';

/** Sign-in buttons for guests, an account link for signed-in users. */
export function HeaderAccount() {
  const me = useMe();

  if (me.isPending) return <span aria-hidden="true" className="h-8 w-20" />;

  const user = currentUser(me.data);
  if (user) {
    return (
      <Link
        to="/settings"
        aria-label={`Account settings for ${user.email}`}
        title={displayName(user) + ' · ' + user.email}
        className="inline-flex size-9 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        {initials(user)}
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Link to="/login" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
        Sign in
      </Link>
      <Link
        to="/signup"
        className={buttonVariants({ size: 'sm', className: 'hidden sm:inline-flex' })}
      >
        Get started
      </Link>
    </div>
  );
}

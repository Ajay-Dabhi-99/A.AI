import { Link } from 'react-router';
import { buttonVariants } from '@/components/ui/button-variants';

export function NotFoundPage() {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-5 py-32 text-center">
      <p className="font-mono text-sm text-primary">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">This page does not exist</h1>
      <p className="mt-3 text-muted-foreground">
        The link may be broken, or the page may have moved.
      </p>
      <Link to="/" className={buttonVariants({ className: 'mt-8' })}>
        Back to home
      </Link>
    </section>
  );
}

import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="mx-auto w-full max-w-md animate-rise text-center">
      <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
        404
      </p>
      <h1 className="mt-3 text-[26px] font-semibold tracking-[-0.02em]">Page not found</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">
        The link may be old, or the page has moved.
      </p>
      <Link
        to="/"
        className="mt-6 inline-flex text-sm font-medium text-primary underline underline-offset-4"
      >
        Back to registration
      </Link>
    </div>
  );
}

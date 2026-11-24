import { ArrowRight, CalendarDays, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

export function HomePage() {
  return (
    <div className="mx-auto w-full max-w-3xl py-4 sm:py-10">
      <header className="animate-rise text-center">
        <p className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          SIA G9
        </p>
        <h1 className="mt-3 text-[30px] leading-[1.15] font-semibold tracking-[-0.02em] text-balance sm:text-[38px]">
          How are you joining us?
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
          Guests can browse events and register. Staff can check people in, or volunteer for an
          event.
        </p>
      </header>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Link
          to="/events"
          className="group animate-rise-slow rounded-xl border border-border bg-card p-6 shadow-[0_1px_2px_oklch(0.235_0.012_268/0.04),0_10px_30px_-24px_oklch(0.235_0.012_268/0.35)] outline-none transition-[background-color,border-color,transform] duration-150 ease-out hover:border-border hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/35 active:scale-[0.995]"
        >
          <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
            <CalendarDays className="size-5" aria-hidden />
          </span>
          <span className="mt-5 flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em]">
            I'm a guest
            <ArrowRight
              className="size-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
              aria-hidden
            />
          </span>
          <span className="mt-1.5 block text-[13.5px] leading-relaxed text-muted-foreground">
            Browse the events and register for the one you're attending. You'll get a QR ticket by
            email.
          </span>
        </Link>

        <Link
          to="/staff"
          className="group animate-rise-slow rounded-xl border border-border bg-card p-6 shadow-[0_1px_2px_oklch(0.235_0.012_268/0.04),0_10px_30px_-24px_oklch(0.235_0.012_268/0.35)] outline-none transition-[background-color,border-color,transform] duration-150 ease-out hover:border-border hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/35 active:scale-[0.995]"
        >
          <span className="grid size-11 place-items-center rounded-full bg-accent text-accent-foreground">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <span className="mt-5 flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em]">
            I'm staff
            <ArrowRight
              className="size-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5"
              aria-hidden
            />
          </span>
          <span className="mt-1.5 block text-[13.5px] leading-relaxed text-muted-foreground">
            Sign in to check in attendees, or sign up to volunteer. Volunteer requests are approved
            by the team.
          </span>
        </Link>
      </div>
    </div>
  );
}

import { Link, NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/events', label: 'Events', end: false },
];

export function Layout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
            <span className="grid size-7 place-items-center rounded-md bg-primary text-[11px] font-semibold tracking-tight text-primary-foreground">
              EM
            </span>
            <span className="hidden text-[15px] font-semibold tracking-[-0.01em] min-[380px]:inline">
              Event Manager
            </span>
          </Link>

          <nav className="flex items-center gap-0.5">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <Outlet />
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <p>Event Manager · {new Date().getFullYear()}</p>
          <p>Trouble registering? Ask the front desk.</p>
        </div>
      </footer>
    </div>
  );
}

import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { getAccessToken } from '../lib/auth-client.js';
import { homeHref } from '../lib/guards.js';
import { useHeaderColor, useTenant } from '../lib/tenant.js';
import { Button, buttonClass } from './button.js';
import { Menu, X } from 'lucide-react';

const LINKS = [
  { label: 'Equipment', to: '/equipment' },
  { label: 'Contact', to: '/contact' },
];

export function FloatingNav() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const tenant = useTenant();
  const tenantName = tenant?.name ?? '';
  const mark = tenant?.iconUrl ?? tenant?.logoUrl;
  const signedIn = typeof window !== 'undefined' && Boolean(getAccessToken());
  const bar = useHeaderColor();
  const tile = 'rounded-sm px-3 hover:bg-current/10';
  const linkClass = (active: boolean) =>
    ['inline-flex min-h-11 items-center', tile, active ? 'font-medium underline decoration-2 underline-offset-8' : ''].join(' ');

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const authActions = signedIn ? (
    <Button variant="primary" onClick={() => window.location.assign(homeHref())}>
      Dashboard
    </Button>
  ) : (
    <>
      <Link to="/login" className={`text-sm ${linkClass(false)}`}>
        Sign in
      </Link>
      <Link to="/signup" className={buttonClass('primary')}>Register</Link>
    </>
  );

  return (
    <header className={['sticky top-0 z-50', bar ? '' : 'bg-nav text-text-inverse'].join(' ')} style={bar ?? undefined}>
      <div className="mx-auto flex min-h-14 max-w-shell items-center justify-between gap-6 px-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-6">
          <Link to={homeHref()} className="flex min-w-0 items-center gap-2 text-base font-medium" aria-label={`${tenantName} home`}>
            {mark && <img src={mark} alt="" className="h-8 w-auto max-w-[120px] object-contain" />}
            <span className="truncate">{tenantName}</span>
          </Link>
          <nav className="hidden items-center gap-1 text-sm sm:flex" aria-label="Primary">
            {LINKS.map((link) => (
              <Link key={link.to} to={link.to} className={linkClass(pathname === link.to)}>
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="hidden items-center gap-2 sm:flex">{authActions}</div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-sm hover:bg-current/10 sm:hidden"
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-1 border-t border-current/15 px-4 pb-6 pt-2 sm:hidden" aria-label="Mobile">
          <nav className="flex flex-col" aria-label="Primary">
            {LINKS.map((link) => (
              <Link key={link.to} to={link.to} className={`w-full text-base ${linkClass(pathname === link.to)}`}>
                {link.label}
              </Link>
            ))}
          </nav>
          <div className="mt-2 flex flex-col gap-2 [&_a]:w-full [&_button]:w-full">{authActions}</div>
        </div>
      )}
    </header>
  );
}

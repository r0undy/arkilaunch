import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { getAccessToken } from '../lib/auth-client.js';
import { Button } from './button.js';
import { CloseIcon, MenuIcon } from './icons.js';

const LINKS = [
  { label: 'Equipments', to: '/equipment' },
  { label: 'Contact', to: '/contact' },
];

// DSD §4 FloatingNav (marketing tier): sticky, glass only past scrollY > 24
// (--blur-mk-nav, --border-glass, --shadow-mk-nav). Rendered here in
// Yardboard tokens, not SprintForge's cool palette. Below sm, the nav links
// and auth actions move into a burger-triggered panel -- at 360px baseline
// width there isn't room for "ArkiLaunch / Almara" + 2 links + 2 buttons on
// one row.
export function FloatingNav({ className }: { className?: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const signedIn = typeof window !== 'undefined' && Boolean(getAccessToken());

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 24);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // A route change (following a link from the panel) should close it, same
  // as any off-canvas menu -- otherwise it's still open, invisibly, on the
  // page the user just navigated to.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const authActions = signedIn ? (
    <Button size="default" variant="secondary" onClick={() => window.location.assign('/account')}>
      My account
    </Button>
  ) : (
    <>
      <Link to="/login">
        <Button size="default" variant="ghost">
          Sign in
        </Button>
      </Link>
      <Link to="/register">
        <Button size="default" variant="primary">
          Register
        </Button>
      </Link>
    </>
  );

  return (
    <header
      className={[
        // Idle used to be bg-transparent, which let the marketing frame's
        // own (slightly darker) background show through right up to the
        // nav's bottom edge -- a visible seam against the paper-toned
        // content sitting just below it. Always matching bg-bg-mk keeps the
        // nav visually part of the page at rest; scrolling only adds the
        // glass blur/shadow/border on top of that same base color.
        'sticky top-0 z-50 bg-bg-mk transition-shadow duration-[160ms]',
        scrolled || open ? 'shadow-mk-nav backdrop-blur-[24px] border-b border-border-glass' : '',
        className ?? '',
      ].join(' ')}
    >
      <div className="flex items-center justify-between px-6 py-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="font-display text-lg font-semibold text-ink-mk">ArkiLaunch</span>
          <span className="font-display text-lg font-semibold text-text-muted">/ Almara</span>
        </Link>
        <nav className="hidden items-center gap-6 sm:flex" aria-label="Primary">
          {LINKS.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={pathname === link.to ? 'text-sm font-semibold text-text' : 'text-sm text-text-muted hover:text-text'}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 sm:flex">{authActions}</div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-sm text-ink-mk sm:hidden"
        >
          {open ? <CloseIcon className="h-6 w-6" /> : <MenuIcon className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-1 border-t border-border-glass px-6 pb-6 pt-2 sm:hidden" aria-label="Mobile">
          <nav className="flex flex-col" aria-label="Primary">
            {LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className={[
                  'block min-h-11 w-full py-3 text-base',
                  pathname === link.to ? 'font-semibold text-text' : 'text-text-muted',
                ].join(' ')}
              >
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

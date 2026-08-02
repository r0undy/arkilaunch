import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { getAccessToken } from '../lib/auth-client.js';
import { Button } from './button.js';

const LINKS = [
  { label: 'Equipments', to: '/equipment' },
  { label: 'Contact', to: '/contact' },
];

// DSD §4 FloatingNav (marketing tier): sticky, glass only past scrollY > 24
// (--blur-mk-nav, --border-glass, --shadow-mk-nav). Rendered here in
// Yardboard tokens, not SprintForge's cool palette.
export function FloatingNav() {
  const [scrolled, setScrolled] = useState(false);
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

  return (
    <header
      className={[
        'sticky top-0 z-50 flex items-center justify-between px-6 py-4 transition-shadow duration-[160ms]',
        scrolled
          ? 'bg-bg-mk/90 shadow-mk-nav backdrop-blur-[24px] border-b border-border-glass'
          : 'bg-transparent',
      ].join(' ')}
    >
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
      <div className="flex items-center gap-2">
        {signedIn ? (
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
        )}
      </div>
    </header>
  );
}

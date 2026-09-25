import { Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { Button } from '../components/button.js';
import { SkipLink } from '../components/skip-link.js';

// ArkiLaunch's own landing page (platform host only; see routes/index.tsx).
// Uses the same marketing tier as the tenant storefronts.

const PLATFORM_DOMAIN = import.meta.env.VITE_PLATFORM_DOMAIN ?? 'arkilaunch.tech';

function toLabel(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

const FEATURES = [
  {
    title: 'A storefront with your name on it',
    body: 'Customers browse your fleet, pick dates and book at your own address.',
  },
  {
    title: 'Quotes in under a minute',
    body: 'Rate cards, trucking formulas, diesel prices and tolls add themselves up.',
  },
  {
    title: 'Timesheets that check themselves',
    body: "Paper time reports are read and matched against the operator's log before anything is billed.",
  },
  {
    title: 'Billing without disputes',
    body: 'Statements, deposits and payments come from the same reconciled hours.',
  },
];

const STEPS = [
  { title: 'Apply', body: 'Tell us about your company: SEC, TIN and one contact person.' },
  { title: 'Get approved', body: 'We check your registration and send your owner account an activation link.' },
  { title: 'Go live', body: 'Your storefront and back office open at your own address.' },
];

// Type a company name, watch its address form; submitting carries the name
// into registration.
function AddressPreview() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const label = toLabel(name) || 'yourcompany';

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      sessionStorage.setItem('arkilaunch.registrationCompanyName', name.trim());
    } catch {
      // Private mode: the company name is simply typed again on step 2.
    }
    void navigate({ to: '/register' });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-3 rounded-sm border border-border bg-surface-mk p-4">
      <p className="truncate text-sm text-text-muted" aria-live="polite">
        https://<strong className="text-text">{label}</strong>.{PLATFORM_DOMAIN}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="company-name">
          Your company name
        </label>
        <input
          id="company-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your company name"
          maxLength={200}
          className="min-h-11 flex-1 rounded-sm border border-border-strong bg-bg px-3 text-text"
        />
        <Button type="submit">Claim this address</Button>
      </div>
    </form>
  );
}

function PlatformLanding() {
  const navigate = useNavigate();
  return (
    <div data-tier="marketing" className="flex min-h-screen flex-col bg-bg-mk-frame">
      <SkipLink />
      <header className="mx-auto flex w-full max-w-shell items-center justify-between px-6 py-4">
        <Link to="/" className="font-display text-lg font-semibold text-ink-mk">
          ArkiLaunch
        </Link>
        <Link to="/login" className="text-sm font-semibold text-text hover:underline">
          Sign in
        </Link>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-shell flex-1 flex-col gap-16 bg-bg-mk px-6 py-10 shadow-mk-inset sm:px-10">
        <section className="flex flex-col gap-4">
          <h1 className="max-w-2xl font-display text-[28px] font-semibold uppercase leading-[1.15] text-ink-mk sm:text-5xl lg:text-6xl">
            Launch your equipment rental business
          </h1>
          <p className="max-w-md border-l-2 border-primary pl-4 text-sm text-text-muted">
            Storefront, quotes, dispatch, timesheets and billing in one place, at an address with your company&apos;s
            name on it.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => navigate({ to: '/register' })}>Register your company</Button>
            <Button variant="secondary" onClick={() => navigate({ to: '/login' })}>
              Sign in
            </Button>
          </div>
          <AddressPreview />
        </section>

        <section aria-labelledby="features-title" className="flex flex-col gap-6">
          <h2 id="features-title" className="font-display text-2xl font-semibold text-ink-mk">
            What you get
          </h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <article key={f.title} className="rounded-sm border border-border bg-surface-mk p-6">
                <h3 className="font-display text-lg font-semibold text-ink-mk">{f.title}</h3>
                <p className="mt-2 text-sm text-text-muted">{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="how-title" className="flex flex-col gap-6">
          <h2 id="how-title" className="font-display text-2xl font-semibold text-ink-mk">
            Open in three steps
          </h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-2">
                <span className="font-display text-3xl font-semibold text-primary">{i + 1}</span>
                <h3 className="font-semibold text-text">{s.title}</h3>
                <p className="text-sm text-text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="bg-surface-mk">
        <div className="mx-auto max-w-shell px-6 py-8 text-sm text-text-muted">ArkiLaunch &copy; 2026</div>
      </footer>
    </div>
  );
}

export { PlatformLanding };

import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { CatalogTenantListResponse } from '@arkilaunch/shared';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { SkipLink } from '../components/skip-link.js';
import { apiGet } from '../lib/api-client.js';
import { tenantOrigin } from '../lib/host.js';

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
  { title: 'Register', body: 'Tell us about your company: SEC, TIN and one contact person.' },
  { title: 'Activate', body: 'Open the link we email you and set your password.' },
  { title: 'Go live', body: 'Your storefront and back office open at your own address, in your colors.' },
];

// The directory filters live in the URL (?q=&category=&location=) so a
// filtered list can be shared. `/` is also the tenant home, so the search
// is read loosely rather than through a route-level validateSearch.
type DirectorySearch = { q?: string; category?: string; location?: string };

function readSearch(raw: Record<string, unknown>): DirectorySearch {
  const pick = (k: string) => (typeof raw[k] === 'string' && raw[k] !== '' ? (raw[k] as string) : undefined);
  const out: DirectorySearch = {};
  for (const k of ['q', 'category', 'location'] as const) {
    const v = pick(k);
    if (v) out[k] = v;
  }
  return out;
}

function Directory() {
  const navigate = useNavigate();
  const search = readSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const [q, setQ] = useState(search.q ?? '');
  const [location, setLocation] = useState(search.location ?? '');
  const params = new URLSearchParams({ limit: '60', ...search }).toString();
  const { data, isPending, isError } = useQuery({
    queryKey: ['catalog', 'tenants', params] as const,
    queryFn: () => apiGet<CatalogTenantListResponse>(`/catalog/tenants?${params}`),
    placeholderData: keepPreviousData,
  });

  function apply(next: DirectorySearch) {
    void navigate({ to: '/', search: readSearch({ ...search, ...next }) as never, replace: true });
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    apply({ q: q.trim(), location: location.trim() });
  }

  return (
    <section aria-labelledby="directory-title" className="flex flex-col gap-6">
      <h2 id="directory-title" className="font-display text-2xl font-semibold text-ink-mk">
        Find a rental company
      </h2>
      <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end">
        <Input label="Company name" type="search" value={q} onChange={(e) => setQ(e.target.value)} maxLength={100} />
        <Select
          label="Equipment"
          value={search.category ?? ''}
          onChange={(e) => apply({ category: e.target.value })}
        >
          <option value="">Any equipment</option>
          {(data?.categories ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Input
          label="City or province"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={100}
        />
        <Button type="submit">Search</Button>
      </form>
      {isError ? (
        <p className="text-sm text-text-muted">The directory could not be loaded. Try again in a moment.</p>
      ) : isPending ? (
        <p className="text-sm text-text-muted">Loading companies…</p>
      ) : data.items.length === 0 ? (
        <p className="text-sm text-text-muted">No rental companies match these filters.</p>
      ) : (
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
          {data.items.map((t) => {
            const place = [t.city, t.province].filter(Boolean).join(', ');
            return (
              <li key={t.slug}>
                <a
                  href={tenantOrigin(t.slug)}
                  className="flex h-full gap-4 rounded-sm border border-border bg-surface-mk p-5 hover:border-border-strong"
                >
                  {t.logoUrl ? (
                    <img src={t.logoUrl} alt="" className="size-14 shrink-0 object-contain" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex size-14 shrink-0 items-center justify-center rounded-sm bg-primary font-display text-xl font-semibold text-on-primary"
                    >
                      {t.name.charAt(0)}
                    </span>
                  )}
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="font-display text-lg font-semibold text-ink-mk">{t.name}</span>
                    {t.tagline && <span className="text-sm text-text-muted">{t.tagline}</span>}
                    {place && <span className="text-xs text-text-muted">{place}</span>}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

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

        <Directory />

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

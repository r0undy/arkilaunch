import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import {
  ArrowRight,
  Calculator,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Mail,
  MapPin,
  Phone,
  Receipt,
  Search,
  SearchX,
  Store,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { CatalogTenantListItem, CatalogTenantListResponse } from '@arkilaunch/shared';
import { Button } from '../components/button.js';
import { Select } from '../components/select.js';
import { SkipLink } from '../components/skip-link.js';
import { EmptyState } from '../components/empty-state.js';
import { LoadError } from '../components/load-error.js';
import { Pagination } from '../components/pagination.js';
import { apiGet } from '../lib/api-client.js';
import { onPrimaryFor } from '../lib/brand.js';
import { tenantOrigin } from '../lib/host.js';

// ArkiLaunch's own landing page (platform host only; see routes/index.tsx).

const PLATFORM_DOMAIN = import.meta.env.VITE_PLATFORM_DOMAIN ?? 'arkilaunch.app';
// ponytail: placeholder contact until the real inbox and line exist; set them per env.
const CONTACT_EMAIL = import.meta.env.VITE_PLATFORM_CONTACT_EMAIL || `hello@${PLATFORM_DOMAIN}`;
const CONTACT_PHONE = import.meta.env.VITE_PLATFORM_CONTACT_PHONE;

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// True once the element has scrolled into view (and stays true). Without
// IntersectionObserver it starts true, so content is never stuck hidden.
function useInView(ref: RefObject<Element | null>): boolean {
  const [shown, setShown] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (!el || shown) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setShown(true);
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, shown]);
  return shown;
}

function toLabel(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

const FEATURES: { title: string; body: string; icon: LucideIcon }[] = [
  {
    icon: Store,
    title: 'A storefront with your name on it',
    body: 'Customers browse your fleet, pick dates and book at your own address.',
  },
  {
    icon: Calculator,
    title: 'Quotes in under a minute',
    body: 'Rate cards, trucking formulas, diesel prices and tolls add themselves up.',
  },
  {
    icon: ClipboardCheck,
    title: 'Timesheets that check themselves',
    body: "Paper time reports are read and matched against the operator's log before anything is billed.",
  },
  {
    icon: Receipt,
    title: 'Billing without disputes',
    body: 'Statements, deposits and payments come from the same reconciled hours.',
  },
];

const STEPS = [
  { title: 'Register', body: 'Tell us about your company: SEC, TIN and one contact person.' },
  { title: 'Activate', body: 'Open the link we email you and set your password.' },
  { title: 'Go live', body: 'Your storefront and back office open at your own address, in your colors.' },
];

// The directory filters live in the URL (?q=&category=&location=&page=) so
// a filtered list can be shared. `/` is also the tenant home, so the search
// is read loosely rather than through a route-level validateSearch.
type DirectorySearch = { q?: string | undefined; category?: string | undefined; location?: string | undefined; page?: number | undefined };
const DIRECTORY_PAGE = 9;

function readSearch(raw: Record<string, unknown>): DirectorySearch {
  const out: DirectorySearch = {};
  for (const k of ['q', 'category', 'location'] as const) {
    const v = raw[k];
    if (typeof v === 'string' && v !== '') out[k] = v;
  }
  // A number, not a string: the router JSON-quotes numeric strings (?page=%222%22).
  const page = Number(raw.page);
  if (Number.isInteger(page) && page > 1) out.page = page;
  return out;
}

// The web app and the API deploy separately, so for a while the page can
// talk to an API from before migration 0062: items without primaryColor or
// categories, and no total or city list. Fill the gaps rather than crash.
// ponytail: drop once every API revision in rotation serves 0062.
function withDirectoryDefaults(r: Partial<CatalogTenantListResponse>): CatalogTenantListResponse {
  const items = (r.items ?? []).map((t) => ({ ...t, primaryColor: t.primaryColor ?? null, categories: t.categories ?? [] }));
  return { items, total: r.total ?? items.length, categories: r.categories ?? [], locations: r.locations ?? [] };
}

// One company in the directory, in its own brand color: a strip across the
// top and, without a logo, the initial tile.
function CompanyCard({ t }: { t: CatalogTenantListItem }) {
  const place = [t.city, t.province].filter(Boolean).join(', ');
  const href = tenantOrigin(t.slug);
  const brand = t.primaryColor ? { backgroundColor: t.primaryColor, color: onPrimaryFor(t.primaryColor) } : undefined;
  const more = t.categories.length - 3;
  return (
    <a
      href={href}
      className="group flex h-full flex-col overflow-hidden rounded-md border border-border bg-surface transition duration-200 hover:-translate-y-1 hover:shadow-md focus-visible:-translate-y-1 focus-visible:shadow-md"
    >
      <span aria-hidden="true" className="h-1 shrink-0 bg-primary" style={brand} />
      <span className="flex flex-1 flex-col gap-4 p-5">
        <span className="flex gap-4">
          {t.logoUrl ? (
            <img src={t.logoUrl} alt="" className="size-14 shrink-0 object-contain" />
          ) : (
            <span
              aria-hidden="true"
              style={brand}
              className="flex size-14 shrink-0 items-center justify-center rounded-sm bg-primary text-heading-lg text-on-primary"
            >
              {t.name.charAt(0)}
            </span>
          )}
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-heading-md text-text">{t.name}</span>
            {t.tagline && <span className="text-sm text-text-muted">{t.tagline}</span>}
            {place && (
              <span className="flex items-center gap-1 text-xs text-text-muted">
                <MapPin aria-hidden className="size-3.5 shrink-0" />
                {place}
              </span>
            )}
          </span>
        </span>
        {t.categories.length > 0 && (
          <span className="flex flex-wrap gap-1.5">
            <span className="sr-only">Rents out:</span>
            {t.categories.slice(0, 3).map((c) => (
              <span key={c} className="rounded-xs border border-border px-2 py-0.5 font-mono text-xs text-text-muted">
                {c}
              </span>
            ))}
            {more > 0 && (
              <span className="rounded-xs border border-border px-2 py-0.5 font-mono text-xs text-text-muted">+{more}</span>
            )}
          </span>
        )}
      </span>
      {/* Always there on touch; with a mouse it slides in on hover. */}
      <span className="flex items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm transition group-hover:bg-surface-sunk">
        <span className="min-w-0 truncate font-mono text-xs text-text-muted">{new URL(href).host}</span>
        <span className="flex shrink-0 items-center gap-1 font-medium text-accent transition duration-200 pointer-fine:translate-y-1 pointer-fine:opacity-0 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
          Visit storefront
          <ArrowRight aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </a>
  );
}

function Directory() {
  const navigate = useNavigate();
  const section = useRef<HTMLElement>(null);
  const search = readSearch(useSearch({ strict: false }) as Record<string, unknown>);
  const page = search.page ?? 1;
  const offset = (page - 1) * DIRECTORY_PAGE;
  const [q, setQ] = useState(search.q ?? '');
  const { page: _page, ...filters } = search;
  const params = new URLSearchParams({ limit: String(DIRECTORY_PAGE), offset: String(offset), ...(filters as Record<string, string>) }).toString();
  const { data, isPending, isError, isPlaceholderData, refetch } = useQuery({
    queryKey: ['catalog', 'tenants', params] as const,
    queryFn: async () => withDirectoryDefaults(await apiGet<Partial<CatalogTenantListResponse>>(`/catalog/tenants?${params}`)),
    placeholderData: keepPreviousData,
  });

  // Any filter change goes back to page 1; only the pager sets a page.
  // resetScroll: false, or every keystroke would jump to the top.
  function apply(next: DirectorySearch) {
    void navigate({
      to: '/',
      search: readSearch({ ...search, page: undefined, ...next }) as never,
      replace: true,
      resetScroll: false,
    });
  }

  // Live search: the typed name reaches the URL (and the query) 300ms after
  // the last keystroke.
  useEffect(() => {
    const next = q.trim();
    if (next === (search.q ?? '')) return;
    const timer = setTimeout(() => apply({ q: next }), 300);
    return () => clearTimeout(timer);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  function clearAll() {
    setQ('');
    void navigate({ to: '/', search: {} as never, replace: true, resetScroll: false });
  }

  const applied = [
    search.q && {
      label: `“${search.q}”`,
      clear: () => {
        setQ('');
        apply({ q: '' });
      },
    },
    search.category && { label: search.category, clear: () => apply({ category: '' }) },
    search.location && { label: search.location, clear: () => apply({ location: '' }) },
  ].filter((f): f is { label: string; clear: () => void } => Boolean(f));

  const categories = data?.categories ?? [];
  const locations = data?.locations ?? [];
  const total = data?.total ?? 0;
  const chip = (on: boolean) =>
    [
      'min-h-11 shrink-0 rounded-pill border px-4 text-sm font-medium transition-colors',
      on ? 'border-nav bg-nav text-text-inverse' : 'border-border bg-surface text-text hover:border-border-strong',
    ].join(' ');

  return (
    <section ref={section} aria-labelledby="directory-title" className="flex scroll-mt-20 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id="directory-title" className="text-display-md text-text lg:text-display-lg">
          Find a rental company
        </h2>
        <p className="text-body-lg text-text-muted">Rental companies already taking bookings on ArkiLaunch.</p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_16rem] sm:items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="directory-q" className="text-sm font-medium text-text">
              Company name
            </label>
            <div className="relative">
              <Search aria-hidden className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-text-muted" />
              <input
                id="directory-q"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                maxLength={100}
                placeholder="Search by name"
                className="min-h-11 w-full rounded-input border border-border bg-surface py-2.5 pl-12 pr-4 text-base text-text hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              />
            </div>
          </div>
          <Select label="City" value={search.location ?? ''} onChange={(e) => apply({ location: e.target.value })}>
            <option value="">Any city</option>
            {locations.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {search.location && !locations.includes(search.location) && (
              <option value={search.location}>{search.location}</option>
            )}
          </Select>
        </div>

        <div
          role="group"
          aria-label="Equipment"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden"
        >
          {['', ...categories].map((c) => {
            const on = (search.category ?? '') === c;
            return (
              <button key={c || 'all'} type="button" aria-pressed={on} onClick={() => apply({ category: c })} className={chip(on)}>
                {c || 'All equipment'}
              </button>
            );
          })}
        </div>

        <div className="flex min-h-11 flex-wrap items-center gap-2 text-sm">
          <p aria-live="polite" className="mr-2 font-medium text-text">
            {isPending ? 'Searching…' : `${total} ${total === 1 ? 'company' : 'companies'}`}
          </p>
          {applied.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={f.clear}
              aria-label={`Remove filter ${f.label}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-border bg-surface-sunk px-3 text-text hover:border-border-strong"
            >
              {f.label}
              <X aria-hidden className="size-4" />
            </button>
          ))}
          {applied.length > 0 && (
            <button type="button" onClick={clearAll} className="min-h-11 rounded-sm px-2 font-medium text-accent hover:underline">
              Clear all
            </button>
          )}
        </div>
      </div>

      {isError ? (
        <LoadError message="The directory could not be loaded. Check your connection and try again." onRetry={() => void refetch()} />
      ) : isPending ? (
        <div role="status" className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <span className="sr-only">Loading companies</span>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} aria-hidden="true" className="h-48 animate-pulse rounded-md bg-border/60" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No rental companies match"
          description="Try another name or city, or show every kind of equipment."
          action={
            applied.length > 0 ? (
              <Button variant="secondary" onClick={clearAll}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Keyed by what is shown, so each new result set plays its rise-in once. */}
          <ul
            key={`${offset}:${data.items.map((t) => t.slug).join()}`}
            className={['grid gap-6 transition-opacity sm:grid-cols-2 lg:grid-cols-3', isPlaceholderData ? 'opacity-60' : ''].join(' ')}
          >
            {data.items.map((t, i) => (
              <li key={t.slug} className="animate-rise" style={{ animationDelay: `${i * 50}ms` }}>
                <CompanyCard t={t} />
              </li>
            ))}
          </ul>
          <Pagination
            offset={offset}
            limit={DIRECTORY_PAGE}
            total={total}
            noun="companies"
            busy={isPlaceholderData}
            onOffsetChange={(next) => {
              const n = next / DIRECTORY_PAGE + 1;
              apply({ page: n });
              section.current?.scrollIntoView({ block: 'start' });
            }}
          />
        </>
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
    <form onSubmit={onSubmit} className="flex w-full min-w-0 flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-md sm:p-8">
      <h2 className="text-heading-lg text-text">Your storefront address</h2>
      <p className="truncate font-mono text-sm text-text-muted" aria-live="polite">
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
          className="min-h-11 flex-1 rounded-input border border-border bg-surface px-4 text-text"
        />
        <Button type="submit">Claim this address</Button>
      </div>
    </form>
  );
}

function Features() {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useInView(ref);
  return (
    <section aria-labelledby="features-title" className="flex flex-col gap-6">
      <h2 id="features-title" className="text-display-md text-text lg:text-display-lg">
        What you get
      </h2>
      <div ref={ref} className="grid gap-6 sm:grid-cols-2">
        {FEATURES.map((f, i) => (
          <article
            key={f.title}
            style={{ transitionDelay: shown ? `${i * 80}ms` : undefined }}
            className={[
              'group flex flex-col gap-4 rounded-md border border-border bg-surface p-6 transition duration-400 ease-out hover:-translate-y-1 hover:shadow-md',
              shown ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0',
            ].join(' ')}
          >
            <span className="flex size-12 items-center justify-center rounded-sm bg-primary/15 text-text transition-colors group-hover:bg-primary">
              <f.icon aria-hidden className="size-6" />
            </span>
            <div>
              <h3 className="text-heading-md text-text">{f.title}</h3>
              <p className="mt-2 text-sm text-text-muted">{f.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// A small picture of what each step looks like, so the card is not just text.
function StepVisual({ step }: { step: number }) {
  const box = 'rounded-sm border border-border bg-bg p-4 text-sm';
  if (step === 0)
    return (
      <div className={`${box} flex flex-col gap-2`} aria-hidden>
        {['Company name', 'SEC registration', 'TIN'].map((f) => (
          <span key={f} className="rounded-input border border-border bg-surface px-3 py-2 text-text-muted">
            {f}
          </span>
        ))}
      </div>
    );
  if (step === 1)
    return (
      <div className={`${box} flex items-center gap-3`} aria-hidden>
        <Mail className="size-5 shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate text-text">Your ArkiLaunch account is ready</span>
        <span className="shrink-0 font-medium text-accent">Set password →</span>
      </div>
    );
  return (
    <div className={box} aria-hidden>
      <span className="block truncate rounded-pill bg-surface px-4 py-2 font-mono text-text">
        https://<strong>yourcompany</strong>.{PLATFORM_DOMAIN}
      </span>
    </div>
  );
}

// "Open in three steps" as a horizontal scroll-snap track: swipe, scroll or
// use the arrows/dots. The track itself is focusable, so arrow keys scroll
// it natively; it stays an <ol> for screen readers.
function StepCarousel() {
  const track = useRef<HTMLOListElement>(null);
  const slides = useRef<(HTMLLIElement | null)[]>([]);
  const [active, setActive] = useState(0);

  // Slide i's scroll offset: its distance from the first slide.
  const offset = (i: number) => (slides.current[i]?.offsetLeft ?? 0) - (slides.current[0]?.offsetLeft ?? 0);

  // The active step is whichever slide sits nearest the track's start; at the
  // far end (a wide screen where the last slide cannot reach the start) it is
  // the last one.
  function onScroll() {
    const t = track.current;
    if (!t) return;
    if (t.scrollLeft >= t.scrollWidth - t.clientWidth - 2) return setActive(STEPS.length - 1);
    let best = 0;
    STEPS.forEach((_, i) => {
      if (Math.abs(offset(i) - t.scrollLeft) < Math.abs(offset(best) - t.scrollLeft)) best = i;
    });
    setActive(best);
  }

  function go(i: number) {
    // scrollTo on the track, not scrollIntoView, so the page itself never jumps vertically.
    track.current?.scrollTo({ left: offset(i), behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  const arrow =
    'flex size-11 items-center justify-center rounded-pill border border-border-strong bg-surface text-text hover:bg-surface-sunk disabled:opacity-40 disabled:hover:bg-surface';

  return (
    <section aria-labelledby="how-title" className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <h2 id="how-title" className="text-display-md text-text lg:text-display-lg">
          Open in three steps
        </h2>
        <div className="hidden gap-2 sm:flex">
          <button type="button" className={arrow} onClick={() => go(active - 1)} disabled={active === 0} aria-label="Previous step">
            <ChevronLeft aria-hidden className="size-5" />
          </button>
          <button type="button" className={arrow} onClick={() => go(active + 1)} disabled={active === STEPS.length - 1} aria-label="Next step">
            <ChevronRight aria-hidden className="size-5" />
          </button>
        </div>
      </div>
      <ol
        ref={track}
        tabIndex={0}
        aria-label="Steps"
        onScroll={onScroll}
        className="-mx-4 flex snap-x snap-mandatory gap-6 overflow-x-auto scroll-px-4 px-4 pb-2 [scrollbar-width:none] sm:-mx-8 sm:scroll-px-8 sm:px-8 [&::-webkit-scrollbar]:hidden"
      >
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            ref={(el) => {
              slides.current[i] = el;
            }}
            className={[
              'flex shrink-0 basis-[85%] snap-start flex-col gap-5 rounded-lg border bg-surface p-6 transition duration-300 sm:basis-[60%] sm:p-8 lg:basis-[42%]',
              active === i ? 'border-border-strong shadow-md' : 'border-border',
            ].join(' ')}
          >
            <span className="self-start rounded-sm bg-primary px-3 py-1 font-mono text-heading-lg text-on-primary">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h3 className="text-heading-lg text-text">{s.title}</h3>
              <p className="mt-2 text-base text-text-muted">{s.body}</p>
            </div>
            <StepVisual step={i} />
          </li>
        ))}
      </ol>
      <div className="flex justify-center gap-1">
        {STEPS.map((s, i) => (
          <button
            key={s.title}
            type="button"
            onClick={() => go(i)}
            aria-label={`Step ${i + 1} of ${STEPS.length}: ${s.title}`}
            aria-current={active === i ? 'step' : undefined}
            className="flex size-11 items-center justify-center"
          >
            <span
              className={[
                'block h-2 rounded-pill transition-all duration-300',
                active === i ? 'w-8 bg-primary' : 'w-2 bg-border-strong',
              ].join(' ')}
            />
          </button>
        ))}
      </div>
    </section>
  );
}

// The page's last word: register, or talk to a person.
function ClosingCta() {
  const navigate = useNavigate();
  const link = 'inline-flex min-h-11 items-center gap-3 rounded-sm text-base hover:underline';
  return (
    <section
      id="contact"
      aria-labelledby="cta-title"
      className="grid gap-10 rounded-lg bg-nav p-8 text-text-inverse lg:grid-cols-[3fr_2fr] lg:items-center lg:p-12"
    >
      <div className="flex flex-col gap-5">
        <h2 id="cta-title" className="text-display-md lg:text-display-lg">
          Ready to launch your storefront?
        </h2>
        <p className="max-w-xl text-body-lg text-text-inverse/70">
          Register today and take your first booking at your own address this week.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => navigate({ to: '/register' })}>Register your company</Button>
          <Link to="/login" className="inline-flex min-h-11 items-center rounded-sm px-3 text-sm hover:bg-current/10">
            Sign in
          </Link>
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t border-current/15 pt-8 lg:border-l lg:border-t-0 lg:pl-10 lg:pt-0">
        <h3 className="text-heading-md">Talk to us</h3>
        <p className="text-sm text-text-inverse/70">Questions about pricing, setup or moving your fleet over.</p>
        <a href={`mailto:${CONTACT_EMAIL}`} className={link}>
          <Mail aria-hidden className="size-5 text-primary" />
          {CONTACT_EMAIL}
        </a>
        {CONTACT_PHONE && (
          <a href={`tel:${CONTACT_PHONE.replace(/\s+/g, '')}`} className={link}>
            <Phone aria-hidden className="size-5 text-primary" />
            {CONTACT_PHONE}
          </a>
        )}
      </div>
    </section>
  );
}

function PlatformLanding() {
  const navigate = useNavigate();
  // In-page jumps (the header's Contact link) glide rather than cut; the
  // reduced-motion rule in index.css overrides this back to instant.
  useEffect(() => {
    const html = document.documentElement;
    html.style.scrollBehavior = 'smooth';
    return () => {
      html.style.scrollBehavior = '';
    };
  }, []);
  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <SkipLink />
      <header className="sticky top-0 z-50 bg-nav text-text-inverse">
        <div className="mx-auto flex min-h-14 w-full max-w-shell items-center justify-between px-4 sm:px-8">
        <Link to="/" className="text-base font-medium">
          ArkiLaunch
        </Link>
        <nav className="flex items-center gap-1 text-sm" aria-label="Primary">
          <a href="#contact" className="inline-flex min-h-11 items-center rounded-sm px-3 hover:bg-current/10">
            Contact
          </a>
          <Link to="/login" className="inline-flex min-h-11 items-center rounded-sm px-3 hover:bg-current/10">
            Sign in
          </Link>
        </nav>
        </div>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-shell flex-1 flex-col gap-16 px-4 py-12 sm:px-8 lg:gap-24 lg:py-20">
        <section className="grid items-center gap-10 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-5">
          <h1 className="text-display-lg text-text lg:text-display-xl">
            Launch your equipment rental business
          </h1>
          <p className="max-w-xl text-body-lg text-text-muted">
            Storefront, quotes, dispatch, timesheets and billing in one place, at an address with your company&apos;s
            name on it.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => navigate({ to: '/register' })}>Register your company</Button>
            <Button variant="secondary" onClick={() => navigate({ to: '/login' })}>
              Sign in
            </Button>
          </div>
          </div>
          {/* The hero's right half: the address a company gets, typed live. */}
          <AddressPreview />
        </section>

        <Directory />

        <Features />
        <StepCarousel />
        <ClosingCta />
      </main>
      <footer className="bg-nav text-text-inverse">
        <div className="mx-auto max-w-shell px-4 py-10 text-sm text-text-inverse/70 sm:px-8">ArkiLaunch &copy; 2026</div>
      </footer>
    </div>
  );
}

export { PlatformLanding };

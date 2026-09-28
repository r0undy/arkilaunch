import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import {
  Calculator,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Mail,
  Phone,
  Receipt,
  Store,
  type LucideIcon,
} from 'lucide-react';
import type { CatalogTenantListResponse } from '@arkilaunch/shared';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Select } from '../components/select.js';
import { SkipLink } from '../components/skip-link.js';
import { apiGet } from '../lib/api-client.js';
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
      <h2 id="directory-title" className="text-display-md text-text lg:text-display-lg">
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
                  className="flex h-full gap-4 rounded-md border border-border bg-surface p-5 transition-shadow hover:shadow-md"
                >
                  {t.logoUrl ? (
                    <img src={t.logoUrl} alt="" className="size-14 shrink-0 object-contain" />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="flex size-14 shrink-0 items-center justify-center rounded-sm bg-primary text-heading-lg text-on-primary"
                    >
                      {t.name.charAt(0)}
                    </span>
                  )}
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-heading-md text-text">{t.name}</span>
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

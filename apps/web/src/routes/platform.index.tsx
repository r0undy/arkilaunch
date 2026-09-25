import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

// ArkiLaunch's own landing page (platform host only; see routes/index.tsx).
// Visual system: discord.design.md via the [data-tier="platform"] tokens in
// index.css -- ink frame, indigo hero, Blurple on CTAs only, one candy color
// per feature card, 12px pills against 120px poster cards.

const PLATFORM_DOMAIN = import.meta.env.VITE_PLATFORM_DOMAIN ?? 'arkilaunch.tech';
const JOBS = ['Quote', 'Dispatch', 'Track', 'Bill'];

function toLabel(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function Pill({ to, children, tone = 'blurple' }: { to: '/register' | '/login'; children: ReactNode; tone?: 'blurple' | 'ghost' }) {
  const toneClass =
    tone === 'blurple'
      ? 'bg-pf-blurple text-white hover:bg-pf-blurple-hover active:bg-pf-blurple-dark'
      : 'bg-white text-pf-ink hover:bg-pf-greyple';
  return (
    <Link
      to={to}
      className={`inline-flex h-14 items-center justify-center rounded-pf-pill px-6 text-lg transition-colors sm:h-[65px] sm:text-xl ${toneClass}`}
    >
      {children}
    </Link>
  );
}

// The hero's one interactive moment: type a company name, watch its own
// address form. Submitting carries the name into registration.
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
    <form onSubmit={onSubmit} className="w-full max-w-xl rounded-[28px] bg-pf-ink/60 p-3 ring-1 ring-white/15 backdrop-blur">
      <div className="flex items-center gap-2 px-3 pb-3 pt-1" aria-hidden="true">
        <span className="size-3 rounded-full bg-pf-fuchsia" />
        <span className="size-3 rounded-full bg-pf-yellow" />
        <span className="size-3 rounded-full bg-pf-green" />
      </div>
      <p
        className="truncate rounded-pf-pill bg-white px-4 py-3 text-base text-pf-ink sm:text-lg"
        aria-live="polite"
      >
        <span className="text-pf-ink/50">https://</span>
        <strong className="font-bold">{label}</strong>
        <span className="text-pf-ink/50">.{PLATFORM_DOMAIN}</span>
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <label className="sr-only" htmlFor="company-name">
          Your company name
        </label>
        <input
          id="company-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your company name"
          maxLength={200}
          className="h-12 flex-1 rounded-pf-pill bg-white/10 px-4 text-white placeholder:text-white/60 focus:bg-white/15"
        />
        <button
          type="submit"
          className="h-12 rounded-pf-pill bg-pf-blurple px-6 text-white transition-colors hover:bg-pf-blurple-hover active:bg-pf-blurple-dark"
        >
          Claim this address
        </button>
      </div>
    </form>
  );
}

function RotatingJob() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const id = window.setInterval(() => setI((n) => (n + 1) % JOBS.length), 2000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <section
      aria-label="What ArkiLaunch runs"
      className="flex flex-wrap items-baseline justify-center gap-x-4 rounded-[40px] bg-pf-ink px-8 py-10 text-center ring-1 ring-white/10 md:rounded-pf-card md:px-12"
    >
      <span className="font-platform-display text-3xl text-white sm:text-5xl">
        <span className="sr-only">{JOBS.join(', ')}. </span>
        <span aria-hidden="true" className="inline-block min-w-[6ch] text-pf-blurple-hover">
          {JOBS[i]}
        </span>
      </span>
      <span className="font-platform-display text-3xl text-white sm:text-5xl">your whole fleet</span>
    </section>
  );
}

const FEATURES: { title: string; body: string; fill: string; detail: ReactNode }[] = [
  {
    title: 'A storefront with your name on it',
    body: 'Customers browse your fleet, book dates and sign in at your own address. They see your company, not ours.',
    fill: 'bg-pf-pink',
    detail: (
      <div className="rounded-[28px] bg-white p-5 text-pf-ink shadow-none">
        <p className="text-sm text-pf-ink/60">almara.{PLATFORM_DOMAIN}</p>
        <p className="mt-2 text-xl font-bold">Backhoe loader, 1.0 m³</p>
        <p className="mt-1">from ₱12,500 / day</p>
        <p className="mt-4 inline-block rounded-pf-pill bg-pf-ink px-4 py-2 text-white">Book dates</p>
      </div>
    ),
  },
  {
    title: 'Quotes in under a minute',
    body: 'Rate cards, trucking formulas, diesel prices and expressway tolls add themselves up, so the quote is ready while the customer is still on the phone.',
    fill: 'bg-pf-green',
    detail: (
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-[28px] bg-white p-5 text-pf-ink">
        <dt>Excavator, 6 days</dt>
        <dd className="text-right font-bold">₱81,000</dd>
        <dt>Mobilization</dt>
        <dd className="text-right font-bold">₱9,800</dd>
        <dt>NLEX toll, Class 3</dt>
        <dd className="text-right font-bold">₱1,284</dd>
        <dt className="border-t border-pf-ink/15 pt-2 font-bold">Total</dt>
        <dd className="border-t border-pf-ink/15 pt-2 text-right text-xl font-bold">₱92,084</dd>
      </dl>
    ),
  },
  {
    title: 'Timesheets that check themselves',
    body: "Your timekeeper photographs the paper time report. It's read, matched against the operator's log and flagged before a single peso is billed.",
    fill: 'bg-pf-yellow',
    detail: (
      <ul className="flex flex-col gap-2 rounded-[28px] bg-white p-5 text-pf-ink">
        <li className="flex justify-between">
          <span>Mon, 8 hrs</span>
          <span className="font-bold">Matched</span>
        </li>
        <li className="flex justify-between">
          <span>Tue, 7.5 hrs</span>
          <span className="font-bold">Matched</span>
        </li>
        <li className="flex justify-between rounded-pf-pill bg-pf-yellow px-3 py-1">
          <span>Wed, 9 hrs vs 6 hrs</span>
          <span className="font-bold">Needs review</span>
        </li>
      </ul>
    ),
  },
  {
    title: 'Billing without disputes',
    body: 'Weekly statements, deposits and payments come from the same reconciled hours, so every invoice has its evidence attached.',
    fill: 'bg-pf-fuchsia',
    detail: (
      <div className="rounded-[28px] bg-white p-5 text-pf-ink">
        <p className="text-sm text-pf-ink/60">Week of Sep 21</p>
        <p className="mt-1 text-3xl font-bold">₱148,300</p>
        <p className="mt-3">Deposit held: ₱50,000</p>
        <p>Deductions: none</p>
      </div>
    ),
  },
];

const STEPS = [
  { title: 'Apply', body: 'Tell us about your company: SEC and TIN, one contact person. It takes about five minutes.' },
  { title: 'Get approved', body: 'We check your registration and send your owner account an activation link.' },
  { title: 'Go live', body: `Your storefront and back office open at yourcompany.${PLATFORM_DOMAIN}. Add your fleet and start quoting.` },
];

function PlatformLanding() {
  return (
    <div data-tier="platform" data-canvas="dark" className="min-h-screen bg-pf-ink font-platform text-white">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-pf-pill focus:bg-white focus:px-4 focus:py-2 focus:text-pf-ink"
      >
        Skip to content
      </a>
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-4 py-4 sm:px-6 sm:py-6">
        <header className="flex h-14 items-center justify-between rounded-pf-pill bg-pf-navy-deep px-4">
          <Link to="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight" aria-label="ArkiLaunch home">
            <span aria-hidden="true" className="grid size-8 place-items-center rounded-[10px] bg-pf-blurple text-sm">
              A
            </span>
            ArkiLaunch
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-2 sm:gap-6">
            <a href="#features" className="hidden hover:underline sm:inline">
              Features
            </a>
            <a href="#how" className="hidden hover:underline sm:inline">
              How it works
            </a>
            <Link to="/login" className="rounded-pf-pill px-3 py-2 hover:bg-white/10">
              Sign in
            </Link>
          </nav>
        </header>

        <main id="main" className="flex flex-col gap-6">
          <section
            className="pf-starfield relative overflow-hidden rounded-[40px] bg-gradient-to-b from-pf-navy-deep to-pf-navy px-6 py-14 sm:px-12 md:rounded-pf-card md:px-16 md:py-24"
            aria-labelledby="hero-title"
          >
            <div className="relative grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
              <div className="flex flex-col gap-6">
                <h1 id="hero-title" className="font-platform-display text-[2.6rem] leading-[0.95] sm:text-6xl">
                  Launch your equipment rental business
                </h1>
                <p className="max-w-[46ch] text-lg leading-relaxed text-white/85 sm:text-xl">
                  One place for your storefront, quotes, dispatch, timesheets and billing. Every rental company gets its
                  own address.
                </p>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Pill to="/register">Register your company</Pill>
                  <Pill to="/login" tone="ghost">
                    Sign in
                  </Pill>
                </div>
              </div>
              <AddressPreview />
            </div>
          </section>

          <RotatingJob />

          <section id="features" aria-label="Features" className="flex flex-col gap-6">
            {FEATURES.map((f, i) => (
              <article
                key={f.title}
                className={`grid items-center gap-8 rounded-[40px] px-6 py-12 text-pf-ink sm:px-12 md:rounded-pf-card md:px-16 md:py-20 lg:grid-cols-2 ${f.fill}`}
              >
                <div className={i % 2 ? 'lg:order-2' : ''}>
                  <h2 className="font-platform-display text-3xl leading-none sm:text-4xl">{f.title}</h2>
                  <p className="mt-4 max-w-[46ch] text-lg leading-relaxed">{f.body}</p>
                </div>
                <div className="mx-auto w-full max-w-sm">{f.detail}</div>
              </article>
            ))}
          </section>

          <section
            id="how"
            aria-labelledby="how-title"
            className="rounded-[40px] bg-pf-navy px-6 py-14 sm:px-12 md:rounded-pf-card md:px-16 md:py-20"
          >
            <h2 id="how-title" className="font-platform-display text-3xl sm:text-4xl">
              Open in three steps
            </h2>
            <ol className="mt-10 grid gap-8 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex flex-col gap-3">
                  <span aria-hidden="true" className="font-platform-display text-5xl text-pf-blurple-hover">
                    {i + 1}
                  </span>
                  <h3 className="text-xl font-bold">{s.title}</h3>
                  <p className="leading-relaxed text-white/80">{s.body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-12">
              <Pill to="/register">Register your company</Pill>
            </div>
          </section>
        </main>

        <footer className="flex flex-col gap-4 rounded-pf-pill px-4 py-10 text-white/70 sm:flex-row sm:items-center sm:justify-between">
          <p>ArkiLaunch &copy; 2026. Built for Philippine equipment rental companies.</p>
          <nav aria-label="Footer" className="flex gap-6">
            <Link to="/register" className="hover:text-white">
              Register
            </Link>
            <Link to="/login" className="hover:text-white">
              Sign in
            </Link>
          </nav>
        </footer>
      </div>
    </div>
  );
}

export { PlatformLanding };

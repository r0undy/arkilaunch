import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

// ArkiLaunch's own landing page (platform host only; see routes/index.tsx).
// Visual system: discord.design.md via the [data-tier="platform"] tokens in
// index.css -- full-bleed indigo hero over an ink frame, Blurple on CTAs
// only, one candy color per feature band, 12px pills against 120px cards.

const PLATFORM_DOMAIN = import.meta.env.VITE_PLATFORM_DOMAIN ?? 'arkilaunch.tech';
const JOBS = ['Quote', 'Dispatch', 'Track', 'Bill'];

function toLabel(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

const PILL = 'inline-flex h-14 items-center justify-center rounded-pf-pill px-6 text-lg transition-colors sm:h-[65px] sm:text-xl';
const BLURPLE = 'bg-pf-blurple text-white hover:bg-pf-blurple-hover active:bg-pf-blurple-dark';
const GHOST = 'bg-white text-pf-ink hover:bg-pf-greyple';

function Pill({ to, children, tone = 'blurple' }: { to: '/register' | '/login'; children: ReactNode; tone?: 'blurple' | 'ghost' }) {
  return (
    <Link to={to} className={`${PILL} ${tone === 'blurple' ? BLURPLE : GHOST}`}>
      {children}
    </Link>
  );
}

function Mark({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="9" fill="currentColor" />
      <path d="M8 23 16 8l8 15h-5l-3-6-3 6z" fill="#000" />
    </svg>
  );
}

// Hero art: the product itself, a quote being built in the back office with
// the customer's storefront card floating over it (Discord's "in-product peek").
function HeroPeek() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-[560px] select-none pb-28">
      <div className="overflow-hidden rounded-[20px] bg-[#23272a] text-left text-white shadow-[0_40px_80px_-20px_rgba(0,0,0,0.6)] ring-1 ring-white/10">
        <div className="grid grid-cols-[88px_1fr] sm:grid-cols-[132px_1fr]">
          <div className="flex flex-col gap-1 bg-[#1e2124] p-3 text-xs text-white/60 sm:text-sm">
            <p className="mb-2 font-bold text-white">Bayani Rentals</p>
            <p>Bookings</p>
            <p className="rounded-md bg-white/10 px-2 py-1 text-white">Quotes</p>
            <p>Fleet</p>
            <p>Timesheets</p>
            <p>Billing</p>
          </div>
          <div className="flex flex-col gap-3 p-4 sm:p-5">
            <div className="flex items-center justify-between">
              <p className="font-bold">Quote Q-0142</p>
              <span className="rounded-pf-pill bg-[#43b581] px-2.5 py-0.5 text-xs font-medium">Ready to send</span>
            </div>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
              <dt className="text-white/70">Excavator PC200, 6 days</dt>
              <dd className="font-medium">₱81,000</dd>
              <dt className="text-white/70">Mobilization, 42 km</dt>
              <dd className="font-medium">₱9,800</dd>
              <dt className="text-white/70">NLEX toll, Class 3</dt>
              <dd className="font-medium">₱1,284</dd>
              <dt className="border-t border-white/10 pt-2 font-bold">Total</dt>
              <dd className="border-t border-white/10 pt-2 text-lg font-bold">₱92,084</dd>
            </dl>
          </div>
        </div>
      </div>
      <div className="absolute bottom-0 right-4 w-52 rotate-[3deg] rounded-[20px] bg-white p-4 text-pf-ink shadow-[0_30px_60px_-15px_rgba(0,0,0,0.6)] sm:-right-6 sm:w-60">
        <p className="text-xs text-pf-ink/60">bayani.{PLATFORM_DOMAIN}</p>
        <p className="mt-1 font-bold">Backhoe loader, 1.0 m³</p>
        <p className="text-sm">from ₱12,500 / day</p>
        <p className="mt-3 inline-block rounded-pf-pill bg-pf-ink px-3 py-1.5 text-sm text-white">Book dates</p>
      </div>
    </div>
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
      className="mx-4 rounded-[40px] bg-pf-ink px-6 py-10 text-center ring-1 ring-white/10 sm:mx-6 md:rounded-pf-card md:py-14"
    >
      <p className="font-platform-display text-3xl leading-none text-white sm:text-5xl lg:text-6xl">
        <span className="sr-only">Quote, dispatch, track and bill your whole fleet.</span>
        <span aria-hidden="true">
          <span className="inline-block min-w-[5.5ch] text-left text-pf-blurple-hover sm:text-right">{JOBS[i]}</span>{' '}
          your whole fleet
        </span>
      </p>
    </section>
  );
}

const PANEL = 'rounded-[24px] bg-white p-5 text-pf-ink shadow-[0_24px_48px_-24px_rgba(0,0,0,0.35)] sm:p-6';

const FEATURES: { title: string; body: string; fill: string; ink: string; detail: ReactNode }[] = [
  {
    title: 'A storefront with your name on it',
    body: 'Customers browse your fleet, pick dates and book at your own address. They see your company, not ours.',
    fill: 'bg-pf-pink',
    ink: 'text-pf-ink',
    detail: (
      <div className="grid grid-cols-2 gap-3">
        {[
          ['Backhoe loader', '₱12,500'],
          ['Excavator PC200', '₱13,500'],
          ['Dump truck, 10 wh', '₱9,000'],
          ['Road roller', '₱8,200'],
        ].map(([name, rate]) => (
          <div key={name} className={PANEL}>
            <div className="mb-3 h-16 rounded-[14px] bg-pf-pink/70" />
            <p className="font-bold leading-tight">{name}</p>
            <p className="text-sm text-pf-ink/70">{rate} / day</p>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Timesheets that check themselves',
    body: "Your timekeeper photographs the paper time report. It's read, matched against the operator's log and flagged before a single peso is billed.",
    fill: 'bg-pf-yellow',
    ink: 'text-pf-ink',
    detail: (
      <ul className={`${PANEL} flex flex-col gap-3`}>
        {[
          ['Mon, Sep 21', '8.0 hrs', 'Matched'],
          ['Tue, Sep 22', '7.5 hrs', 'Matched'],
          ['Wed, Sep 23', '9.0 vs 6.0 hrs', 'Needs review'],
        ].map(([day, hrs, state]) => (
          <li key={day} className="flex items-center justify-between gap-3">
            <span>
              <span className="block font-bold">{day}</span>
              <span className="text-sm text-pf-ink/70">{hrs}</span>
            </span>
            <span
              className={`rounded-pf-pill px-2.5 py-1 text-sm font-medium ${state === 'Matched' ? 'bg-[#43b581] text-white' : 'bg-[#ed4245] text-white'}`}
            >
              {state}
            </span>
          </li>
        ))}
      </ul>
    ),
  },
  {
    title: 'Billing without disputes',
    body: 'Weekly statements, deposits and payments come from the same reconciled hours, so every invoice arrives with its evidence.',
    fill: 'bg-pf-fuchsia',
    ink: 'text-white',
    detail: (
      <div className={PANEL}>
        <p className="text-sm text-pf-ink/60">Statement, week of Sep 21</p>
        <p className="mt-1 text-4xl font-extrabold tracking-tight">₱148,300</p>
        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <p className="rounded-[14px] bg-pf-ink/5 p-3">
            <span className="block text-pf-ink/60">Deposit held</span>
            <span className="font-bold">₱50,000</span>
          </p>
          <p className="rounded-[14px] bg-pf-ink/5 p-3">
            <span className="block text-pf-ink/60">Deductions</span>
            <span className="font-bold">None</span>
          </p>
        </div>
      </div>
    ),
  },
];

const STEPS = [
  { title: 'Apply', body: 'Tell us about your company: SEC, TIN and one contact person. It takes about five minutes.' },
  { title: 'Get approved', body: 'We check your registration and send your owner account an activation link.' },
  { title: 'Go live', body: 'Your storefront and back office open at your own address. Add your fleet and start quoting.' },
];

// Closing band: type a company name and watch its address form; submitting
// carries the name into registration.
function ClaimAddress() {
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
    <section
      aria-labelledby="claim-title"
      className="pf-starfield relative mx-4 overflow-hidden rounded-[40px] bg-gradient-to-b from-pf-navy to-pf-navy-deep px-6 py-16 text-center sm:mx-6 md:rounded-pf-card md:py-24"
    >
      <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-6">
        <h2 id="claim-title" className="font-platform-display text-4xl leading-[0.95] sm:text-6xl">
          Your address is waiting
        </h2>
        <p className="w-full truncate text-lg text-white/80 sm:text-2xl" aria-live="polite">
          https://<strong className="text-white">{label}</strong>.{PLATFORM_DOMAIN}
        </p>
        <form onSubmit={onSubmit} className="flex w-full flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="company-name">
            Your company name
          </label>
          <input
            id="company-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your company name"
            maxLength={200}
            className="h-14 flex-1 rounded-pf-pill bg-white px-4 text-lg text-pf-ink placeholder:text-pf-ink/50 sm:h-[65px]"
          />
          <button type="submit" className={`${PILL} ${BLURPLE}`}>
            Claim this address
          </button>
        </form>
      </div>
    </section>
  );
}

function PlatformLanding() {
  return (
    <div data-tier="platform" data-canvas="dark" className="min-h-screen overflow-x-hidden bg-pf-ink font-platform text-white">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-pf-pill focus:bg-white focus:px-4 focus:py-2 focus:text-pf-ink"
      >
        Skip to content
      </a>

      <div className="pf-starfield relative overflow-hidden bg-gradient-to-b from-pf-navy-deep via-pf-navy-deep to-pf-navy">
        {/* Horizon glow the hero sits on, Discord's hill line. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-[60%] left-1/2 h-[90%] w-[160%] -translate-x-1/2 rounded-[50%] bg-pf-blurple-dark/40 blur-3xl"
        />
        <header className="relative mx-auto flex h-20 max-w-[1260px] items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5 text-xl font-extrabold tracking-tight" aria-label="ArkiLaunch home">
            <Mark />
            ArkiLaunch
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-6 text-base">
            <a href="#features" className="hidden hover:underline md:inline">
              Features
            </a>
            <a href="#how" className="hidden hover:underline md:inline">
              How it works
            </a>
            <Link to="/login" className="rounded-pf-pill bg-white px-4 py-2 text-sm font-medium text-pf-ink hover:bg-pf-greyple">
              Sign in
            </Link>
          </nav>
        </header>

        <section
          aria-labelledby="hero-title"
          className="relative mx-auto grid max-w-[1260px] items-center gap-14 px-4 pb-20 pt-10 sm:px-6 md:pb-28 md:pt-16 lg:grid-cols-[1fr_1fr]"
        >
          <div className="flex flex-col items-start gap-6">
            <h1 id="hero-title" className="font-platform-display text-[2.75rem] leading-[0.92] sm:text-6xl xl:text-7xl">
              Launch your equipment rental business
            </h1>
            <p className="max-w-[44ch] text-lg leading-relaxed text-white/85 sm:text-xl">
              Storefront, quotes, dispatch, timesheets and billing in one place, at an address with your company's name
              on it.
            </p>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Pill to="/register" tone="ghost">
                Register your company
              </Pill>
              <Pill to="/login">Sign in to your company</Pill>
            </div>
          </div>
          <HeroPeek />
        </section>
      </div>

      <main id="main" className="mx-auto flex max-w-[1308px] flex-col gap-6 py-6">
        <RotatingJob />

        <section id="features" aria-label="Features" className="flex flex-col gap-6">
          {FEATURES.map((f, i) => (
            <article
              key={f.title}
              className={`mx-4 grid items-center gap-10 rounded-[40px] px-6 py-12 sm:mx-6 sm:px-12 md:rounded-pf-card md:px-20 md:py-24 lg:grid-cols-2 lg:gap-16 ${f.fill} ${f.ink}`}
            >
              <div className={i % 2 ? 'lg:order-2' : ''}>
                <h2 className="font-platform-display text-3xl leading-[0.95] sm:text-5xl">{f.title}</h2>
                <p className="mt-5 max-w-[42ch] text-lg leading-relaxed sm:text-xl">{f.body}</p>
              </div>
              <div className="mx-auto w-full max-w-md">{f.detail}</div>
            </article>
          ))}
        </section>

        <section id="how" aria-labelledby="how-title" className="px-4 py-14 sm:px-6 md:px-20 md:py-20">
          <h2 id="how-title" className="font-platform-display text-3xl sm:text-5xl">
            Open in three steps
          </h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex flex-col gap-3 rounded-[24px] bg-[#23272a] p-6 ring-1 ring-white/10">
                <span className="grid size-10 place-items-center rounded-pf-pill bg-white/10 text-lg font-bold">{i + 1}</span>
                <h3 className="text-xl font-bold">{s.title}</h3>
                <p className="leading-relaxed text-white/75">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <ClaimAddress />
      </main>

      <footer className="mx-auto max-w-[1260px] px-4 pb-10 pt-16 sm:px-6">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="flex flex-col gap-3">
            <p className="font-platform-display text-3xl text-pf-blurple-hover">Rent smarter</p>
            <p className="max-w-[36ch] text-white/70">Built for Philippine equipment rental companies.</p>
          </div>
          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-16 gap-y-3 text-white/80">
            <a href="#features" className="hover:underline">
              Features
            </a>
            <Link to="/register" className="hover:underline">
              Register
            </Link>
            <a href="#how" className="hover:underline">
              How it works
            </a>
            <Link to="/login" className="hover:underline">
              Sign in
            </Link>
          </nav>
        </div>
        <div className="mt-12 flex items-center justify-between border-t border-pf-blurple pt-6">
          <Link to="/" className="flex items-center gap-2 text-lg font-extrabold" aria-label="ArkiLaunch home">
            <Mark className="size-7" />
            ArkiLaunch
          </Link>
          <Link to="/register" className={`inline-flex h-11 items-center rounded-pf-pill px-4 ${BLURPLE}`}>
            Register
          </Link>
        </div>
        <p className="mt-6 text-sm text-white/50">&copy; 2026 ArkiLaunch</p>
      </footer>
    </div>
  );
}

export { PlatformLanding };

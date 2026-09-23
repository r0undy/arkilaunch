import { createRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { publicLayoutRoute } from './_public.js';
import { Surface } from '../components/surface.js';
import { EmptyState } from '../components/empty-state.js';

// Figma 750:6444 "Help Center" draws six sections. Four of them -- knowledge-base
// search, the three category cards, Top Articles and the network-status meter --
// sit on top of nothing: there is no article store and no status endpoint. The
// Submit Support Ticket form needs the same ticket table that /app/tickets is a
// GapScreen for. Only the direct channels are real, so only the direct channels
// are here, for the reason unbacked-screens.tsx already gives: a page that looks
// finished but answers nobody is worse than a short page that says where to go.
// Recorded in docs/report-figma-route-alignment.md section 3.

function MailIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <path d="m3 6 9 6.5L21 6" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5L16 12l4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 6.2 2 2 0 0 1 6 4z" />
    </svg>
  );
}

// The frame's email channel reads ops@fleetcore.io -- a leftover from whatever
// template it was built from, naming a product that is not this one. The real
// address is the one /contact already publishes.
const CHANNELS: { label: string; detail: string; href: string; icon: ReactNode }[] = [
  {
    label: 'Email',
    detail: 'arkilaunch2026@gmail.com',
    href: 'mailto:arkilaunch2026@gmail.com',
    icon: <MailIcon />,
  },
  {
    label: 'Phone',
    detail: '800-4657',
    href: 'tel:8004657',
    icon: <PhoneIcon />,
  },
];

function HelpPage() {
  return (
    <div className="flex flex-col gap-6 px-6 py-10 sm:px-10">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink-mk">Help center</h1>
        <p className="mt-1 text-sm text-text-muted">
          Reach Almara Construction directly. Someone answers during yard hours.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-xs font-semibold uppercase tracking-[0.04em] text-text-muted">
          Direct channels
        </h2>
        <ul className="flex flex-col gap-3">
          {CHANNELS.map((channel) => (
            <li key={channel.label}>
              <a
                href={channel.href}
                className="block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <Surface radius="md" elevation="sm" className="flex items-center gap-4 p-4 hover:border-border-strong">
                  <span className="text-accent">{channel.icon}</span>
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold text-text">{channel.label}</span>
                    <span className="text-sm text-text-muted">{channel.detail}</span>
                  </span>
                </Surface>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <EmptyState
        title="There are no support articles yet"
        description="Nothing in the schema holds a help article or a support ticket, and no endpoint serves one, so this page has no knowledge base to search and no form that would reach anybody. Use a channel above and a person will answer."
      />
    </div>
  );
}

export const helpRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: '/help',
  component: HelpPage,
});

import { createRoute } from '@tanstack/react-router';
import { publicLayoutRoute } from './_public.js';

function ContactPage() {
  return (
    <div className="flex flex-col gap-4 px-6 py-10 sm:px-10">
      <h1 className="font-display text-2xl font-semibold text-ink-mk">Contact</h1>
      <p className="text-sm text-text-muted">
        Almara Construction, Quezon City. Call 800-4657 or email arkilaunch2026@gmail.com.
      </p>
    </div>
  );
}

export const contactRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: '/contact',
  component: ContactPage,
});

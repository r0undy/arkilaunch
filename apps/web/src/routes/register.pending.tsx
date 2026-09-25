import { createRoute, Link } from '@tanstack/react-router';
import { authLayoutRoute } from './_auth.js';
import { Surface } from '../components/surface.js';
import { onlyOn } from '../lib/guards.js';

function CheckEmailPage() {
  return (
    <Surface radius="lg" elevation="md" className="flex w-full max-w-sm flex-col items-center gap-4 p-8 text-center">
      <h1 className="font-display text-xl font-semibold text-text">Check your email</h1>
      <p className="text-sm text-text-muted">
        We sent an activation link to the email you registered with. Open it and set your password, and your
        storefront goes live right away.
      </p>
      <Link to="/login" className="text-sm font-semibold text-accent hover:underline">
        Back to sign in
      </Link>
    </Surface>
  );
}

export const registerPendingRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  beforeLoad: onlyOn('platform'),
  path: '/register/pending',
  component: CheckEmailPage,
});

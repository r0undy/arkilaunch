import { createRoute, redirect, Link } from '@tanstack/react-router';
import { rootRoute } from './__root.js';
import { getAccessToken, clearTokens } from '../lib/auth-client.js';
import { Button } from '../components/button.js';

function AppShell() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="flex items-center justify-between border-b border-border bg-surface px-6 py-4">
        <span className="font-display text-lg font-semibold text-text">ArkiLaunch</span>
        <Button
          variant="ghost"
          onClick={() => {
            clearTokens();
            window.location.assign('/login');
          }}
        >
          Sign out
        </Button>
      </header>
      <main className="p-6">
        <p className="text-text-muted">Signed in. POC scaffolds for the new backend slices:</p>
        <ul className="mt-3 flex flex-col gap-2">
          <li>
            <Link to="/app/quotes" className="text-accent underline-offset-2 hover:underline">
              Quotes (RFC-3)
            </Link>
          </li>
          <li>
            <Link to="/app/edtr" className="text-accent underline-offset-2 hover:underline">
              EDTR (RFC-2)
            </Link>
          </li>
          <li>
            <Link to="/app/kyc" className="text-accent underline-offset-2 hover:underline">
              KYC (RFC-2)
            </Link>
          </li>
        </ul>
      </main>
    </div>
  );
}

// Route guard: PRD-F7 tenancy slice has no app-level UI yet, only the
// identity proof. Unauthenticated visitors never see the shell.
export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    if (!getAccessToken()) {
      throw redirect({ to: '/login' });
    }
  },
  component: AppShell,
});

import { createRoute, Link, Outlet } from '@tanstack/react-router';
import { homeHref } from '../lib/guards.js';
import { currentHost } from '../lib/host.js';
import { useTenantName } from '../lib/tenant.js';
import { SkipLink } from '../components/skip-link.js';
import { rootRoute } from './__root.js';

function BrandPanel() {
  const name = useTenantName();
  const tenantName = currentHost.kind === 'platform' ? 'ArkiLaunch' : name;
  return (
    <div className="flex flex-col justify-between bg-[var(--yb-color-text)] px-8 py-10 text-text-inverse lg:w-[42%] lg:px-14 lg:py-16">
      <Link to={homeHref()} className="self-start font-display text-lg font-semibold" aria-label={`${tenantName} home`}>
        {tenantName}
      </Link>
      <div className="my-12 lg:my-0">
        <p className="max-w-sm border-l-2 border-primary pl-4 font-display text-2xl font-semibold leading-snug sm:text-3xl">
          {currentHost.kind === 'platform'
            ? 'Your rental company, on its own address.'
            : "Your timekeeper's handwriting sits right next to the hours we bill."}
        </p>
        <p className="mt-4 max-w-sm text-sm text-text-inverse/70">
          {currentHost.kind === 'platform'
            ? 'For Philippine equipment rental companies.'
            : 'Two independent logs, reconciled before a single peso is deducted.'}
        </p>
      </div>
      <p className="text-xs text-text-inverse/50">{currentHost.kind === 'platform' ? 'ArkiLaunch' : `${tenantName} · Powered by ArkiLaunch`}</p>
    </div>
  );
}

// Sign-in and registration pages on both hosts; the brand panel follows the
// host (ArkiLaunch on the platform, the tenant's name on its own host).
function AuthLayout() {
  return (
    <div
      className="flex min-h-screen flex-col lg:flex-row"
    >
      <SkipLink />
      <BrandPanel />
      <main id="main" className="flex flex-1 items-center justify-center bg-bg px-4 py-12">
        <Outlet />
      </main>
    </div>
  );
}

export const authLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth-layout',
  component: AuthLayout,
});

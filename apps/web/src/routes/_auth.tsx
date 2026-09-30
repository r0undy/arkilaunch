import { createRoute, Link, Outlet } from '@tanstack/react-router';
import { homeHref } from '../lib/guards.js';
import { currentHost } from '../lib/host.js';
import { useTenant } from '../lib/tenant.js';
import { SkipLink } from '../components/skip-link.js';
import { rootRoute } from './__root.js';
import { MessengerLinks, messengerHrefs } from '../components/messenger-links.js';

function BrandPanel() {
  const tenant = useTenant();
  const onPlatform = currentHost.kind === 'platform';
  const tenantName = onPlatform ? 'ArkiLaunch' : (tenant?.name ?? '');
  const logoUrl = onPlatform ? null : tenant?.logoUrl;
  // The tenant's sign-in photo, else its storefront hero; none = the plain panel.
  const photoUrl = onPlatform ? null : (tenant?.loginUrl ?? tenant?.heroUrl);
  return (
    <div
      className={[
        'relative isolate flex flex-col justify-between gap-8 overflow-hidden bg-nav px-6 py-6 text-text-inverse sm:px-8 lg:w-[42%] lg:px-14 lg:py-16',
        photoUrl ? 'min-h-44' : '',
      ].join(' ')}
    >
      {photoUrl && (
        <>
          <img src={photoUrl} alt="" className="absolute inset-0 -z-10 size-full object-cover" />
          <div className="absolute inset-0 -z-10 bg-linear-to-t from-nav from-10% via-nav/60 via-40% to-nav/30" />
        </>
      )}
      <Link
        to={homeHref()}
        className="flex items-center gap-3 self-start text-heading-md text-shadow-md"
        aria-label={`${tenantName} home`}
      >
        {logoUrl && <img src={logoUrl} alt="" className="h-10 w-auto max-w-[140px] rounded-sm bg-white object-contain p-1" />}
        {tenantName}
      </Link>
      <div className="hidden flex-col gap-10 text-shadow-lg lg:flex">
        <div>
          <p className="max-w-lg text-display-md font-semibold tracking-tight text-pretty xl:text-[2.25rem] xl:leading-[2.75rem]">
            {onPlatform
              ? 'Your rental company, on its own address.'
              : tenant?.tagline || "Your timekeeper's handwriting sits right next to the hours we bill."}
          </p>
          <p className="mt-4 max-w-md text-base text-text-inverse/75">
            {onPlatform
              ? 'For Philippine equipment rental companies.'
              : 'Two independent logs, reconciled before a single peso is deducted.'}
          </p>
        </div>
        <p className="text-xs text-text-inverse/60">{onPlatform ? 'ArkiLaunch' : `${tenantName} · Powered by ArkiLaunch`}</p>
      </div>
    </div>
  );
}

function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <SkipLink />
      <BrandPanel />
      <div className="flex flex-1 flex-col bg-bg">
        <div className="flex justify-end px-6 pt-6 sm:px-10">
          <Link to={homeHref()} className="text-sm font-semibold text-text-muted hover:text-text hover:underline">
            ← Back to {currentHost.kind === 'platform' ? 'ArkiLaunch' : 'the storefront'}
          </Link>
        </div>
        <main id="main" className="flex flex-1 items-center justify-center px-4 py-10">
          <Outlet />
        </main>
        <HelpFooter />
      </div>
    </div>
  );
}

// The tenant's own contact details, so a stuck customer knows who to call.
function HelpFooter() {
  const tenant = useTenant();
  if (currentHost.kind === 'platform' || !(tenant?.phone || tenant?.contactEmail)) return null;
  return (
    <footer className="flex flex-wrap justify-center gap-x-6 gap-y-1 border-t border-border px-6 py-5 text-sm text-text-muted">
      <span>Need help signing in?</span>
      {tenant.phone && (
        <a href={`tel:${tenant.phone}`} className="font-semibold text-text hover:underline">
          {tenant.phone}
        </a>
      )}
      {messengerHrefs(tenant.phone) && (
        <span>
          Viber / Telegram:<MessengerLinks phone={tenant.phone} className="font-semibold text-text hover:underline" />
        </span>
      )}
      {tenant.contactEmail && (
        <a href={`mailto:${tenant.contactEmail}`} className="font-semibold text-text hover:underline">
          {tenant.contactEmail}
        </a>
      )}
    </footer>
  );
}

export const authLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth-layout',
  component: AuthLayout,
});

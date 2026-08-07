import { createRoute, Outlet } from '@tanstack/react-router';
import { rootRoute } from './__root.js';

function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <div className="flex flex-col justify-between bg-[var(--yb-color-text)] px-8 py-10 text-text-inverse lg:w-[42%] lg:px-14 lg:py-16">
        <div className="flex items-center gap-2">
          <span className="font-display text-lg font-semibold">Almara</span>
          <span className="font-display text-lg font-semibold text-text-inverse/60">by ArkiLaunch</span>
        </div>
        <div className="my-12 lg:my-0">
          <p className="max-w-sm border-l-2 border-primary pl-4 font-display text-2xl font-semibold leading-snug sm:text-3xl">
            Your timekeeper&apos;s handwriting sits right next to the hours we bill.
          </p>
          <p className="mt-4 max-w-sm text-sm text-text-inverse/70">
            Two independent logs, reconciled before a single peso is deducted.
          </p>
        </div>
        <p className="text-xs text-text-inverse/50">Almara Construction &middot; Quezon City</p>
      </div>
      <div className="flex flex-1 items-center justify-center bg-bg px-4 py-12">
        <Outlet />
      </div>
    </div>
  );
}

export const authLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth-layout',
  component: AuthLayout,
});

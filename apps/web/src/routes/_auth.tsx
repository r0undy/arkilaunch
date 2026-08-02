import { createRoute, Outlet } from '@tanstack/react-router';
import { rootRoute } from './__root.js';

function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-4 py-12">
      <div className="flex items-center gap-2">
        <span className="font-display text-lg font-semibold text-text">Almara</span>
        <span className="font-display text-lg font-semibold text-text-muted">by ArkiLaunch</span>
      </div>
      <Outlet />
    </div>
  );
}

export const authLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth-layout',
  component: AuthLayout,
});

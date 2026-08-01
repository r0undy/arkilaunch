import { createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from './__root.js';
import { getAccessToken, clearTokens } from '../lib/auth-client.js';

function AppShell() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <span className="text-lg font-semibold text-slate-900">ArkiLaunch</span>
        <button
          type="button"
          onClick={() => {
            clearTokens();
            window.location.assign('/login');
          }}
          className="min-h-11 rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Sign out
        </button>
      </header>
      <main className="p-6">
        <p className="text-slate-600">Signed in. Feature screens land with the F3/F1 slice.</p>
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

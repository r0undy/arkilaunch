import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { authLayoutRoute } from './_auth.js';
import { login } from '../lib/auth-client.js';
import { getCurrentRole, homeRouteForRole } from '../lib/guards.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Surface } from '../components/surface.js';

// Only accept an internal path (starts with '/', not '//'); a leaf value
// like `//evil.com` is protocol-relative and would send a successful login
// off-site. This is the input-validation half of the redirect-preservation
// feature the guards raise via ?redirect=.
function isSafeInternalRedirect(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');
}

function validateLoginSearch(search: Record<string, unknown>): { redirect?: string } {
  return isSafeInternalRedirect(search.redirect) ? { redirect: search.redirect } : {};
}

function LoginPage() {
  const navigate = useNavigate();
  const { redirect: redirectTo } = loginRoute.useSearch();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await login({ email, password });
      if ('requires2fa' in response) {
        // TwoFaChallenge: there is no 2FA verification UI in this app yet
        // (apps/api/src/auth/two-fa.controller.ts exists server-side, but
        // nothing here calls POST /auth/2fa/verify). Say so honestly rather
        // than silently treating the challenge as a successful sign-in.
        setError('Two-factor authentication is required for this account and is not yet supported here.');
        return;
      }
      await navigate({ to: redirectTo ?? homeRouteForRole(getCurrentRole()) });
    } catch {
      setError('Incorrect email or password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Surface radius="lg" elevation="md" className="w-full max-w-sm p-8">
      <form onSubmit={onSubmit} aria-labelledby="login-heading">
        <h1 id="login-heading" className="mb-1 font-display text-xl font-semibold text-text">
          Sign in
        </h1>
        <p className="mb-6 text-sm text-text-muted">Enter your credentials to start renting equipment.</p>

        <div className="mb-4">
          <Input
            label="Email address"
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <Input
          label="Password"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          {...(error ? { error } : {})}
        />
        <button
          type="button"
          disabled
          title="Password reset is admin-initiated for now; contact your administrator"
          className="mt-1 text-sm text-text-muted underline decoration-dotted disabled:cursor-not-allowed"
        >
          Forgot password?
        </button>

        <label className="mt-4 flex min-h-11 items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Remember me for 30 days
        </label>

        <Button type="submit" loading={submitting} disabled={submitting} className="mt-4 w-full">
          Sign in to system
        </Button>

        <p className="mt-6 text-center text-sm text-text-muted">
          No account yet?{' '}
          <Link to="/register" className="font-semibold text-accent hover:underline">
            Create an account
          </Link>
        </p>
      </form>
    </Surface>
  );
}

export const loginRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/login',
  validateSearch: validateLoginSearch,
  component: LoginPage,
});

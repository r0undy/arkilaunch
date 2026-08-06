import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { authLayoutRoute } from './_auth.js';
import { login, verify2fa } from '../lib/auth-client.js';
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
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set once AuthService.login returns a TwoFaChallenge instead of
  // AuthTokens; presence of this token switches the form to the code-entry
  // step (POST /auth/2fa/verify), which is a live, tested backend endpoint.
  const [twoFaToken, setTwoFaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

  async function goHome() {
    await navigate({ to: redirectTo ?? homeRouteForRole(getCurrentRole()) });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await login({ email, password });
      if ('requires2fa' in response) {
        setTwoFaToken(response.twoFaToken);
        return;
      }
      await goHome();
    } catch {
      setError('Incorrect email or password.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onVerifyCode(event: FormEvent) {
    event.preventDefault();
    if (!twoFaToken) return;
    setError(null);
    setSubmitting(true);
    try {
      await verify2fa({ twoFaToken, code });
      await goHome();
    } catch {
      setError('Incorrect or expired code.');
    } finally {
      setSubmitting(false);
    }
  }

  if (twoFaToken) {
    return (
      <Surface radius="lg" elevation="md" className="w-full max-w-sm p-8">
        <form onSubmit={onVerifyCode} aria-labelledby="twofa-heading">
          <h1 id="twofa-heading" className="mb-1 font-display text-xl font-semibold text-text">
            Enter your code
          </h1>
          <p className="mb-6 text-sm text-text-muted">
            Enter the 6-digit code from your authenticator app.
          </p>

          <Input
            label="Verification code"
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            {...(error ? { error } : {})}
          />

          <Button
            type="submit"
            loading={submitting}
            disabled={submitting || code.length !== 6}
            className="mt-4 w-full"
          >
            Verify
          </Button>

          <button
            type="button"
            onClick={() => {
              setTwoFaToken(null);
              setCode('');
              setError(null);
            }}
            className="mt-4 w-full text-center text-sm text-text-muted underline decoration-dotted"
          >
            Back to sign in
          </button>
        </form>
      </Surface>
    );
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

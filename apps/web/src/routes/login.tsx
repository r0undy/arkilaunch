import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { authLayoutRoute } from './_auth.js';
import { login } from '../lib/auth-client.js';
import { getCurrentRole, homeRouteForRole } from '../lib/guards.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Surface } from '../components/surface.js';

function LoginPage() {
  const navigate = useNavigate();
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
      await login({ email, password });
      await navigate({ to: homeRouteForRole(getCurrentRole()) });
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
          title="Password reset is not available yet"
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
  component: LoginPage,
});

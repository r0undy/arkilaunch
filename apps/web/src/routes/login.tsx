import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { rootRoute } from './__root.js';
import { login } from '../lib/auth-client.js';

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
      await navigate({ to: '/' });
    } catch {
      setError('Incorrect email or password.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={onSubmit}
        aria-labelledby="login-heading"
        className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm"
      >
        <h1 id="login-heading" className="mb-6 text-xl font-semibold text-slate-900">
          Sign in to ArkiLaunch
        </h1>

        <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-4 block min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-blue-600 focus:outline focus:outline-2 focus:outline-blue-600"
        />

        <label htmlFor="password" className="mb-1 block text-sm font-medium text-slate-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-6 block min-h-11 w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-blue-600 focus:outline focus:outline-2 focus:outline-blue-600"
        />

        {error && (
          <p role="alert" className="mb-4 text-sm text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="min-h-11 w-full rounded-md bg-blue-700 px-4 py-2 text-base font-medium text-white disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

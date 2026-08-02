import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { rootRoute } from './__root.js';
import { login } from '../lib/auth-client.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Surface } from '../components/surface.js';

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
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Surface radius="lg" elevation="md" className="w-full max-w-sm p-8">
        <form onSubmit={onSubmit} aria-labelledby="login-heading">
          <h1 id="login-heading" className="mb-6 font-display text-xl font-semibold text-text">
            Sign in to ArkiLaunch
          </h1>

          <div className="mb-4">
            <Input
              label="Email"
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="mb-6">
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
          </div>

          <Button type="submit" loading={submitting} disabled={submitting} className="w-full">
            Sign in
          </Button>
        </form>
      </Surface>
    </main>
  );
}

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
});

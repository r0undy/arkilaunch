import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { authLayoutRoute } from './_auth.js';
import { registerCustomer } from '../lib/auth-client.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Surface } from '../components/surface.js';

export const MIN_PASSWORD = 10;

export function signupError(code: string): string {
  if (code === 'email_taken') return 'That email already has an account. Log in instead.';
  if (code === 'signup_unavailable') return 'Sign-up is not open on this site yet.';
  return 'We could not create your account. Check the details and try again.';
}

// Customer self-signup (customer prerequisites CR). A customer is someone
// renting equipment from the yard; the rental business registration flow
// stays at /register. Company details come next, on their own screen,
// because one login may register several companies.
function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (mismatch || !accepted) return;
    setBusy(true);
    setError(null);
    try {
      await registerCustomer({ email, password, acceptedTerms: true });
      await navigate({ to: '/account/companies/new' });
    } catch (err) {
      setError(signupError(err instanceof Error ? err.message : ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Surface radius="lg" elevation="md" className="w-full max-w-sm p-8">
      <form onSubmit={onSubmit} aria-labelledby="signup-heading" className="flex flex-col gap-4">
        <div>
          <h1 id="signup-heading" className="font-display text-xl font-semibold text-text">
            Create account
          </h1>
          <p className="text-sm text-text-muted">Rent equipment for your projects. Company details come next.</p>
        </div>
        <Input label="Email address" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          hint={`At least ${MIN_PASSWORD} characters.`}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          {...(mismatch ? { error: 'Passwords do not match.' } : {})}
        />
        <label className="flex items-start gap-2 text-sm text-text">
          <input
            type="checkbox"
            required
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-primary)]"
          />
          <span>
            I have read and agree to the <Link to="/terms" className="underline">Terms of Service</Link> and{' '}
            <Link to="/privacy" className="underline">Privacy Policy</Link>, and I am of legal age.
          </span>
        </label>
        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" loading={busy} disabled={mismatch || !accepted}>
          Create account
        </Button>
        <p className="text-center text-sm text-text-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-accent hover:underline">
            Log in
          </Link>
        </p>
        <p className="text-center text-xs text-text-muted">
          Renting out equipment?{' '}
          <Link to="/register" className="underline">
            Register your rental business
          </Link>
        </p>
      </form>
    </Surface>
  );
}

export const signupRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/signup',
  component: SignupPage,
});

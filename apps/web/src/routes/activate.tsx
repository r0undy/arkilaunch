import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { authLayoutRoute } from './_auth.js';
import { activateAccount } from '../lib/auth-client.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Surface } from '../components/surface.js';

// Minimum enforced server-side by UserPasswordSchema (min 12). Mirrored
// here as a courtesy so the user is not told to try again by a 400; the
// server check is the authoritative one.
const MIN_PASSWORD_LENGTH = 12;

// The token may arrive in the link (?token=) or be pasted by hand, since
// approval currently hands the token to an admin who relays it -- there is
// no approval email yet.
function validateActivateSearch(search: Record<string, unknown>): { token?: string } {
  return typeof search.token === 'string' && search.token.length > 0 ? { token: search.token } : {};
}

function ActivatePage() {
  const navigate = useNavigate();
  const { token: tokenFromLink } = activateRoute.useSearch();
  const [activationToken, setActivationToken] = useState(tokenFromLink ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    activationToken.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH && !mismatch;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      await activateAccount({ activationToken: activationToken.trim(), password });
      // 204, no tokens issued: the user signs in normally from here.
      await navigate({ to: '/login' });
    } catch {
      setError('That activation token is not valid, or it has already been used.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Surface radius="lg" elevation="md" className="w-full max-w-sm p-8">
      <form onSubmit={onSubmit} aria-labelledby="activate-heading">
        <h1 id="activate-heading" className="mb-1 font-display text-xl font-semibold text-text">
          Set your password
        </h1>
        <p className="mb-6 text-sm text-text-muted">
          Your company has been approved. Choose a password to finish activating your account.
        </p>

        {!tokenFromLink && (
          <div className="mb-4">
            <Input
              label="Activation token"
              id="activationToken"
              name="activationToken"
              required
              value={activationToken}
              onChange={(e) => setActivationToken(e.target.value)}
            />
          </div>
        )}

        <div className="mb-4">
          <Input
            label="New password"
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <p className="mt-1 text-sm text-text-muted">At least {MIN_PASSWORD_LENGTH} characters.</p>
        </div>

        <Input
          label="Confirm password"
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          {...(mismatch ? { error: 'Those passwords do not match.' } : error ? { error } : {})}
        />

        <Button type="submit" loading={submitting} disabled={submitting || !canSubmit} className="mt-4 w-full">
          Activate account
        </Button>

        <p className="mt-6 text-center text-sm text-text-muted">
          Already activated?{' '}
          <Link to="/login" className="font-semibold text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </Surface>
  );
}

export const activateRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/activate',
  validateSearch: validateActivateSearch,
  component: ActivatePage,
});

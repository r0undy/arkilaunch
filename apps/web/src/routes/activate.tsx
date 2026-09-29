import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { authLayoutRoute } from './_auth.js';
import { activateAccount } from '../lib/auth-client.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Surface } from '../components/surface.js';
import { useToast } from '../components/toast.js';
import { isTenantSlug } from '@arkilaunch/shared';
import { currentHost, tenantOrigin } from '../lib/host.js';

// Courtesy mirror of UserPasswordSchema (min 12); the server check is authoritative.
const MIN_PASSWORD_LENGTH = 12;

// A new company's owner activates on the platform host (?slug=): its subdomain is not live yet.
function validateActivateSearch(search: Record<string, unknown>): { token?: string; slug?: string } {
  const out: { token?: string; slug?: string } = {};
  if (typeof search.token === 'string' && search.token.length > 0) out.token = search.token;
  if (typeof search.slug === 'string' && isTenantSlug(search.slug)) out.slug = search.slug;
  return out;
}

function ActivatePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { token: tokenFromLink, slug } = activateRoute.useSearch();
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
      toast.success('Your account is active', 'Sign in with your new password.');
      if (currentHost.kind === 'platform' && slug) {
        window.location.assign(`${tenantOrigin(slug)}/login`);
        return;
      }
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
        <h1 id="activate-heading" className="mb-1 text-heading-lg text-text">
          Set your password
        </h1>
        <p className="mb-6 text-sm text-text-muted">
          Choose a password to finish activating your account.
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

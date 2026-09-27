import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { authLayoutRoute } from './_auth.js';
import { submitRegistration } from '../lib/registration-client.js';
import { ApiError } from '../lib/api-client.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Surface } from '../components/surface.js';
import { captchaError, Turnstile, TURNSTILE_SITE_KEY } from '../components/turnstile.js';
import { onlyOn } from '../lib/guards.js';

function RegisterCompanyDetailsPage() {
  const navigate = useNavigate();
  // Prefilled from the landing page's address preview, if the visitor typed one.
  const [companyName, setCompanyName] = useState(() => {
    try {
      return sessionStorage.getItem('arkilaunch.registrationCompanyName') ?? '';
    } catch {
      return '';
    }
  });
  const [businessAddress, setBusinessAddress] = useState('');
  const [secNumber, setSecNumber] = useState('');
  const [tin, setTin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const waitingOnCaptcha = Boolean(TURNSTILE_SITE_KEY) && !captcha;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await submitRegistration({ companyName, businessAddress, secNumber, tin }, captcha);
      navigate({ to: '/register/pending' });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'This email already has a company waiting for activation. Check your inbox for the link.'
          : (err instanceof ApiError && captchaError(err.message)) ||
              'Something went wrong submitting your application. Please try again.',
      );
      // The token was spent on this attempt; get a fresh one.
      setCaptcha(null);
      setCaptchaKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Surface radius="lg" elevation="md" className="w-full max-w-sm p-8">
      <form onSubmit={onSubmit} aria-labelledby="register-company-heading" className="flex flex-col gap-4">
        <div>
          <h1 id="register-company-heading" className="font-display text-xl font-semibold text-text">
            Company details
          </h1>
          <p className="text-sm text-text-muted">
            SEC and TIN are extracted from your uploaded documents and cross-checked during admin review.
          </p>
        </div>
        <Input label="Company name" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        <Input
          label="Business address"
          required
          value={businessAddress}
          onChange={(e) => setBusinessAddress(e.target.value)}
        />
        <Input label="SEC registration number" required value={secNumber} onChange={(e) => setSecNumber(e.target.value)} />
        <Input label="TIN" required value={tin} onChange={(e) => setTin(e.target.value)} />
        <Turnstile key={captchaKey} onToken={setCaptcha} />
        {error && <p className="text-sm text-error" role="alert">{error}</p>}
        <Button type="submit" loading={submitting} disabled={submitting || waitingOnCaptcha} className="w-full">
          Submit for review
        </Button>
      </form>
    </Surface>
  );
}

export const registerCompanyRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  beforeLoad: onlyOn('platform'),
  path: '/register/company',
  component: RegisterCompanyDetailsPage,
});

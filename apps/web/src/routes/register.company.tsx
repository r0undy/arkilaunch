import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { normalizeSecNumber, normalizeTin } from '@arkilaunch/shared';
import { authLayoutRoute } from './_auth.js';
import { getPersonalDetails, submitRegistration } from '../lib/registration-client.js';
import { ApiError } from '../lib/api-client.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Surface } from '../components/surface.js';
import { captchaError, Turnstile, TURNSTILE_SITE_KEY } from '../components/turnstile.js';
import { onlyOn } from '../lib/guards.js';

// The fields this page owns. A 400 on any other field is from step 1.
const FIELD_ERRORS = {
  companyName: 'Enter the company name.',
  businessAddress: 'Enter the business address.',
  secNumber: 'Use the number as printed on the SEC certificate, e.g. CS201912345.',
  tin: 'A TIN has 9, 12 or 14 digits, e.g. 123-456-789 or 123-456-789-000.',
} as const;
type OwnField = keyof typeof FIELD_ERRORS;

type SubmitError = { field?: OwnField; back?: boolean; text: string };

export function submitError(err: unknown): SubmitError {
  if (!(err instanceof ApiError)) return { text: 'Something went wrong submitting your application. Please try again.' };
  if (err.status === 400) {
    const issues = (err.payload as { errors?: { path?: unknown[] }[] } | null)?.errors ?? [];
    const field = issues.map((i) => i.path?.[0]).find((p): p is OwnField => typeof p === 'string' && p in FIELD_ERRORS);
    if (field) return { field, text: FIELD_ERRORS[field] };
    return { back: true, text: 'Some of your details from the previous step are not valid.' };
  }
  if (err.message === 'duplicate_pending_application') {
    return { text: 'This email already has a company waiting for activation. Check your inbox for the link.' };
  }
  if (err.message === 'email_taken') {
    return { text: 'This email already has an ArkiLaunch account. Use a different email, or log in instead.' };
  }
  if (err.status === 429) return { text: 'Too many attempts. Try again in an hour.' };
  return {
    text: captchaError(err.message) || 'Something went wrong submitting your application. Please try again.',
  };
}

function RegisterCompanyDetailsPage() {
  const navigate = useNavigate();
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
  const [error, setError] = useState<SubmitError | null>(null);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const waitingOnCaptcha = Boolean(TURNSTILE_SITE_KEY) && !captcha;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    // Opened in a new tab or after the draft cleared: step 1 is missing.
    if (!getPersonalDetails()) {
      navigate({ to: '/register', replace: true });
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await submitRegistration(
        { companyName, businessAddress, secNumber: normalizeSecNumber(secNumber), tin: normalizeTin(tin) },
        captcha,
      );
      navigate({ to: '/register/pending', replace: true });
    } catch (err) {
      setError(submitError(err));
      // The token was spent on this attempt; get a fresh one.
      setCaptcha(null);
      setCaptchaKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }
  const fieldError = (field: OwnField) => (error?.field === field ? error.text : undefined);

  return (
    <Surface radius="lg" elevation="md" className="w-full max-w-md p-8">
      <form onSubmit={onSubmit} aria-labelledby="register-company-heading" className="flex flex-col gap-4">
        <div>
          <h1 id="register-company-heading" className="text-heading-lg text-text">
            Company details
          </h1>
          <p className="text-sm text-text-muted">
            SEC and TIN are extracted from your uploaded documents and cross-checked during admin review.
          </p>
        </div>
        <Input
          label="Company name"
          required
          maxLength={200}
          error={fieldError('companyName')}
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
        />
        <Input
          label="Business address"
          required
          maxLength={500}
          error={fieldError('businessAddress')}
          value={businessAddress}
          onChange={(e) => setBusinessAddress(e.target.value)}
        />
        <Input
          label="SEC registration number"
          required
          maxLength={24}
          placeholder="CS201912345"
          pattern="([A-Za-z]{1,3}\d{3}-?\d{4,9}|\d{10,13}(-\d{2})?)"
          title="As printed on the SEC certificate, e.g. CS201912345 or 2021060012345-00"
          hint="From your SEC certificate (Company Reg. No.)."
          error={fieldError('secNumber')}
          value={secNumber}
          onChange={(e) => setSecNumber(e.target.value)}
          onBlur={(e) => setSecNumber(normalizeSecNumber(e.target.value))}
        />
        <Input
          label="TIN"
          required
          inputMode="numeric"
          placeholder="000-000-000-000"
          pattern="\d{3}-\d{3}-\d{3}(-\d{3}|-\d{5})?"
          title="9, 12 or 14 digits: 000-000-000, 000-000-000-000 or 000-000-000-00000"
          hint="From your BIR Form 2303, with the branch code as printed."
          error={fieldError('tin')}
          value={tin}
          onChange={(e) => setTin(e.target.value)}
          onBlur={(e) => setTin(normalizeTin(e.target.value))}
        />
        <Turnstile key={captchaKey} onToken={setCaptcha} />
        {error && !error.field && (
          <p className="text-sm text-error" role="alert">
            {error.text}{' '}
            {error.back && (
              <Link to="/register" className="underline">
                Back to your details
              </Link>
            )}
          </p>
        )}
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

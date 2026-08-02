import { createRoute, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { authLayoutRoute } from './_auth.js';
import { submitRegistration } from '../lib/registration-client.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { Surface } from '../components/surface.js';

function RegisterCompanyDetailsPage() {
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [secNumber, setSecNumber] = useState('');
  const [tin, setTin] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    await submitRegistration({ companyName, businessAddress, secNumber, tin });
    navigate({ to: '/register/pending' });
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
        <Button type="submit" loading={submitting} disabled={submitting} className="w-full">
          Submit for review
        </Button>
      </form>
    </Surface>
  );
}

export const registerCompanyRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: '/register/company',
  component: RegisterCompanyDetailsPage,
});

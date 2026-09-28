import { createRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { authLayoutRoute } from './_auth.js';
import { getPersonalDetails, savePersonalDetails } from '../lib/registration-client.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { MobileInput } from '../components/mobile-input.js';
import { Surface } from '../components/surface.js';
import { onlyOn } from '../lib/guards.js';

function RegisterPersonalDetailsPage() {
  const navigate = useNavigate();
  // Back from the company step finds what was typed here (QA 17).
  const [draft] = useState(getPersonalDetails);
  const [firstName, setFirstName] = useState(draft?.firstName ?? '');
  const [lastName, setLastName] = useState(draft?.lastName ?? '');
  const [mobileNumber, setMobileNumber] = useState(draft?.mobileNumber ?? '');
  const [email, setEmail] = useState(draft?.email ?? '');
  const [jobTitle, setJobTitle] = useState(draft?.jobTitle ?? '');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    savePersonalDetails({ firstName, lastName, mobileNumber, email, jobTitle });
    navigate({ to: '/register/company' });
  }

  return (
    <Surface radius="lg" elevation="md" className="w-full max-w-sm p-8">
      <form onSubmit={onSubmit} aria-labelledby="register-heading" className="flex flex-col gap-4">
        <div>
          <h1 id="register-heading" className="text-heading-lg text-text">
            Create account
          </h1>
          <p className="text-sm text-text-muted">Enter your details to register for the platform.</p>
        </div>
        <Input label="First name" required value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        <Input label="Last name" required value={lastName} onChange={(e) => setLastName(e.target.value)} />
        <MobileInput label="Mobile number" required value={mobileNumber} onChange={setMobileNumber} />
        <Input label="Email address" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Job title / position" required value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
        <p className="text-xs text-text-muted">
          You will set a password after your application is approved.
        </p>
        <Button type="submit" className="w-full">
          Next page
        </Button>
        <p className="text-center text-sm text-text-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-accent hover:underline">
            Log in
          </Link>
        </p>
        <p className="flex justify-center gap-3 text-xs text-text-muted">
          <Link to="/terms">Terms of Service</Link>
          <Link to="/privacy">Privacy Policy</Link>
        </p>
      </form>
    </Surface>
  );
}

export const registerRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  beforeLoad: onlyOn('platform'),
  path: '/register',
  component: RegisterPersonalDetailsPage,
});

import { createRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { CompanyResponse, UserSelfResponse } from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { companiesQueries, usersQueries } from '../lib/queries.js';
import { apiErrorText, apiPatch, apiPost, apiPostForm } from '../lib/api-client.js';
import { clearTokens } from '../lib/auth-client.js';
import { companyStatusLabel } from '../lib/cart-validation.js';
import { Surface } from '../components/surface.js';
import { Input } from '../components/input.js';
import { Button } from '../components/button.js';
import { LoadError } from '../components/load-error.js';
import { Skeleton } from '../components/skeleton.js';
import { useToast } from '../components/toast.js';

const TABS = ['Profile', 'Company', 'Security', 'Notifications'] as const;
type Tab = (typeof TABS)[number];

function useSaveMe() {
  const queryClient = useQueryClient();
  return (data: UserSelfResponse) => queryClient.setQueryData(usersQueries.me().queryKey, data);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-4 sm:p-6">
      <h2 className="font-display text-lg font-semibold text-text">{title}</h2>
      {children}
    </Surface>
  );
}

function initials(me: UserSelfResponse) {
  const fromName = [me.firstName, me.lastName].filter(Boolean).map((n) => n![0]).join('');
  return (fromName || me.email[0] || '?').toUpperCase();
}

function ProfileTab({ me }: { me: UserSelfResponse }) {
  const toast = useToast();
  const save = useSaveMe();
  const [phone, setPhone] = useState(me.phone ?? '');
  const [address, setAddress] = useState(me.address ?? '');

  const update = useMutation({
    mutationFn: () =>
      apiPatch<UserSelfResponse>('/users/me', { phone: phone.trim() || null, address: address.trim() || null }),
    onSuccess: (data) => {
      save(data);
      toast.success('Profile saved');
    },
    onError: (e) => toast.error('Profile not saved', apiErrorText(e)),
  });
  const avatar = useMutation({
    mutationFn: (file: File) => apiPostForm<UserSelfResponse>('/users/me/avatar', {}, file),
    onSuccess: (data) => {
      save(data);
      toast.success('Profile picture updated');
    },
    onError: (e) => toast.error('Picture not uploaded', apiErrorText(e)),
  });

  const fullName = [me.firstName, me.middleName, me.lastName].filter(Boolean).join(' ');

  return (
    <>
      <Section title="Profile picture">
        <div className="flex flex-wrap items-center gap-4">
          {me.avatarUrl ? (
            <img src={me.avatarUrl} alt="Your profile picture" className="h-20 w-20 rounded-full object-cover" />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-20 w-20 items-center justify-center rounded-full bg-primary font-display text-2xl font-semibold text-text"
            >
              {initials(me)}
            </span>
          )}
          <label className="inline-flex min-h-11 cursor-pointer items-center rounded-mk-sm border border-border px-4 text-sm font-medium text-text hover:bg-surface-sunk focus-within:outline focus-within:outline-2 focus-within:outline-focus-ring">
            {avatar.isPending ? 'Uploading…' : 'Upload a photo'}
            <input
              type="file"
              accept="image/jpeg,image/png"
              className="sr-only"
              disabled={avatar.isPending}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) avatar.mutate(file);
                e.target.value = '';
              }}
            />
          </label>
          <p className="w-full text-xs text-text-muted">JPEG or PNG, up to 10 MB.</p>
        </div>
      </Section>

      <Section title="Personal information">
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            update.mutate();
          }}
        >
          <div className="sm:col-span-2">
            <p className="text-sm font-medium text-text">Legal name</p>
            <p className="text-text">{fullName || 'Not yet verified'}</p>
            <p className="text-xs text-text-muted">
              Set from your National ID when the rental team verifies it, so it cannot be edited here.
            </p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-sm font-medium text-text">Email</p>
            <p className="break-all text-text">{me.email}</p>
          </div>
          <Input label="Mobile number" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label="Home address" autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          <div className="sm:col-span-2">
            <Button type="submit" loading={update.isPending}>
              Save profile
            </Button>
          </div>
        </form>
      </Section>
    </>
  );
}

function CompanyForm({ company }: { company: CompanyResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const verified = company.kycStatus === 'approved';
  const [tin, setTin] = useState(company.tin ?? '');
  const [secNumber, setSecNumber] = useState(company.secNumber ?? '');
  const [billingAddress, setBillingAddress] = useState(company.billingAddress ?? '');

  const save = useMutation({
    mutationFn: () =>
      apiPatch<CompanyResponse>(`/me/companies/${company.id}`, {
        billingAddress: billingAddress.trim(),
        ...(verified ? {} : { tin: tin.trim(), ...(secNumber.trim() ? { secNumber: secNumber.trim() } : {}) }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: companiesQueries.mine().queryKey });
      toast.success(`${company.companyName} saved`);
    },
    onError: (e) => toast.error('Company not saved', apiErrorText(e)),
  });

  return (
    <form
      className="grid gap-4 border-t border-border pt-4 first:border-t-0 first:pt-0 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <div className="sm:col-span-2">
        <p className="font-medium text-text">{company.companyName}</p>
        <p className="text-sm text-text-muted">{verified ? 'Verified' : companyStatusLabel(company)}</p>
      </div>
      <Input
        label="TIN"
        value={tin}
        disabled={verified}
        onChange={(e) => setTin(e.target.value)}
        {...(verified ? { hint: 'Locked once verified.' } : {})}
      />
      <Input
        label="Registration number (SEC/DTI)"
        value={secNumber}
        disabled={verified}
        onChange={(e) => setSecNumber(e.target.value)}
      />
      <div className="sm:col-span-2">
        <Input label="Billing address" value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="secondary" loading={save.isPending}>
          Save company
        </Button>
      </div>
    </form>
  );
}

function CompanyTab() {
  const companies = useQuery(companiesQueries.mine());
  return (
    <Section title="Company information">
      {companies.isPending && <Skeleton label="Loading your companies" rows={1} />}
      {companies.isError && (
        <LoadError message="Your companies could not be loaded." onRetry={() => companies.refetch()} />
      )}
      {companies.data?.length === 0 && (
        <p className="text-sm text-text-muted">You have not registered a company yet.</p>
      )}
      {companies.data?.map((c) => <CompanyForm key={c.id} company={c} />)}
      <Link to="/account/companies" className="text-sm font-medium text-text underline">
        Manage companies and documents
      </Link>
    </Section>
  );
}

function SecurityTab() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm !== '' && confirm !== next;
  const tooShort = next !== '' && next.length < 10;

  const change = useMutation({
    mutationFn: () => apiPost('/users/me/password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast.success('Password changed', 'Other devices have been signed out.');
      setCurrent('');
      setNext('');
      setConfirm('');
    },
    onError: (e) => toast.error('Password not changed', apiErrorText(e)),
  });
  const everywhere = useMutation({
    mutationFn: () => apiPost('/users/me/sign-out-everywhere', {}),
    onSuccess: () => {
      clearTokens();
      window.location.assign('/login');
    },
    onError: (e) => toast.error('Could not sign out other devices', apiErrorText(e)),
  });

  return (
    <>
      <Section title="Change password">
        <form
          className="grid max-w-md gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!mismatch && !tooShort && current && next) change.mutate();
          }}
        >
          <Input label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
            {...(tooShort ? { error: 'Use at least 10 characters.' } : {})}
          />
          <Input
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            {...(mismatch ? { error: 'The passwords do not match.' } : {})}
          />
          <div>
            <Button type="submit" loading={change.isPending}>
              Change password
            </Button>
          </div>
        </form>
      </Section>
      <Section title="Sessions">
        <p className="text-sm text-text-muted">
          Signs you out on every device, including this one.
        </p>
        <div>
          <Button variant="secondary" loading={everywhere.isPending} onClick={() => everywhere.mutate()}>
            Sign out everywhere
          </Button>
        </div>
      </Section>
    </>
  );
}

const PREF_LABELS = {
  inApp: ['In-app', 'Quotes, replies and alerts in your notifications list.'],
  email: ['Email', 'A copy of each notification to your email.'],
  sms: ['SMS', 'Text messages for urgent changes to a booking.'],
} as const;

function NotificationsTab({ me }: { me: UserSelfResponse }) {
  const toast = useToast();
  const save = useSaveMe();
  const prefs = me.notificationPrefs ?? { email: true, sms: false, inApp: true };
  const update = useMutation({
    mutationFn: (next: typeof prefs) => apiPatch<UserSelfResponse>('/users/me', { notificationPrefs: next }),
    onSuccess: save,
    onError: (e) => toast.error('Preference not saved', apiErrorText(e)),
  });

  return (
    <Section title="Notification preferences">
      <ul className="flex flex-col divide-y divide-border">
        {(Object.keys(PREF_LABELS) as (keyof typeof PREF_LABELS)[]).map((key) => (
          <li key={key} className="flex items-center justify-between gap-4 py-3">
            <label htmlFor={`pref-${key}`} className="min-w-0">
              <span className="block text-sm font-medium text-text">{PREF_LABELS[key][0]}</span>
              <span className="block text-xs text-text-muted">{PREF_LABELS[key][1]}</span>
            </label>
            <input
              id={`pref-${key}`}
              type="checkbox"
              role="switch"
              className="h-6 w-6 shrink-0 accent-primary"
              checked={prefs[key]}
              disabled={update.isPending}
              onChange={(e) => update.mutate({ ...prefs, [key]: e.target.checked })}
            />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function AccountSettingsPage() {
  const query = useQuery(usersQueries.me());
  const [tab, setTab] = useState<Tab>('Profile');

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-2xl font-semibold text-text">Settings</h1>
      <div role="tablist" aria-label="Settings sections" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls="settings-panel"
            onClick={() => setTab(t)}
            className={[
              'min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium',
              tab === t ? 'border-primary text-text' : 'border-transparent text-text-muted hover:text-text',
            ].join(' ')}
          >
            {t}
          </button>
        ))}
      </div>
      <div id="settings-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="flex flex-col gap-4">
        {query.isPending && <Skeleton label="Loading your profile" rows={2} />}
        {query.isError && (
          <LoadError
            message="Could not load your profile. Check your connection and try again."
            onRetry={() => query.refetch()}
          />
        )}
        {query.isSuccess && tab === 'Profile' && <ProfileTab me={query.data} />}
        {tab === 'Company' && <CompanyTab />}
        {tab === 'Security' && <SecurityTab />}
        {query.isSuccess && tab === 'Notifications' && <NotificationsTab me={query.data} />}
      </div>
    </div>
  );
}

export const accountSettingsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/settings',
  component: AccountSettingsPage,
});

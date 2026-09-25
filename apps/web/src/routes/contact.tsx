import { createRoute } from '@tanstack/react-router';
import { publicLayoutRoute } from './_public.js';
import { useTenant } from '../lib/tenant.js';

// The tenant's own contact details and about text (branding, migration 0051).
function ContactPage() {
  const tenant = useTenant();
  const place = [tenant?.address, tenant?.city, tenant?.province].filter(Boolean).join(', ');
  const hasContact = Boolean(place || tenant?.phone || tenant?.contactEmail);
  return (
    <div className="flex flex-col gap-4 px-6 py-10 sm:px-10">
      <h1 className="font-display text-2xl font-semibold text-ink-mk">Contact</h1>
      {tenant?.about && <p className="max-w-2xl whitespace-pre-line text-sm text-text-muted">{tenant.about}</p>}
      {hasContact ? (
        <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {place && (
            <>
              <dt className="font-semibold text-text">Address</dt>
              <dd className="text-text-muted">{place}</dd>
            </>
          )}
          {tenant?.phone && (
            <>
              <dt className="font-semibold text-text">Phone</dt>
              <dd>
                <a href={`tel:${tenant.phone}`} className="text-accent hover:underline">
                  {tenant.phone}
                </a>
              </dd>
            </>
          )}
          {tenant?.contactEmail && (
            <>
              <dt className="font-semibold text-text">Email</dt>
              <dd>
                <a href={`mailto:${tenant.contactEmail}`} className="text-accent hover:underline">
                  {tenant.contactEmail}
                </a>
              </dd>
            </>
          )}
        </dl>
      ) : (
        <p className="text-sm text-text-muted">{tenant?.name} has not added contact details yet.</p>
      )}
    </div>
  );
}

export const contactRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: '/contact',
  component: ContactPage,
});

import { createRoute, Link } from '@tanstack/react-router';
import { Mail, MessageCircle, Phone, Send } from 'lucide-react';
import { publicLayoutRoute } from './_public.js';
import { useTenant } from '../lib/tenant.js';
import { Surface } from '../components/surface.js';
import { EmptyState } from '../components/empty-state.js';
import { messengerHrefs } from '../components/messenger-links.js';

function HelpPage() {
  const tenant = useTenant();
  const tenantName = tenant?.name ?? '';
  const hrefs = messengerHrefs(tenant?.phone);
  const channels = [
    tenant?.contactEmail && { label: 'Email', detail: tenant.contactEmail, href: `mailto:${tenant.contactEmail}`, Icon: Mail },
    tenant?.phone && { label: 'Phone', detail: tenant.phone, href: `tel:${tenant.phone}`, Icon: Phone },
    hrefs && { label: 'Viber', detail: tenant!.phone!, href: hrefs.viber, Icon: MessageCircle },
    hrefs && { label: 'Telegram', detail: tenant!.phone!, href: hrefs.telegram, Icon: Send },
  ].filter((c) => !!c);
  return (
    <div className="flex flex-col gap-6 px-6 py-10 sm:px-10">
      <div>
        <h1 className="text-display-md text-text">Help center</h1>
        <p className="mt-1 text-sm text-text-muted">
          Reach {tenantName} directly. Someone answers during yard hours.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-text-muted">
          Direct channels
        </h2>
        {channels.length === 0 && (
          <p className="text-sm text-text-muted">
            {tenantName} has not added contact details yet. See the{' '}
            <Link to="/contact" className="text-accent underline">
              contact page
            </Link>
            .
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {channels.map((channel) => (
            <li key={channel.label}>
              <a
                href={channel.href}
                className="block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
              >
                <Surface radius="md" elevation="sm" className="flex items-center gap-4 p-4 hover:border-border-strong">
                  <channel.Icon aria-hidden className="h-6 w-6 shrink-0 text-accent" />
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold text-text">{channel.label}</span>
                    <span className="text-sm text-text-muted">{channel.detail}</span>
                  </span>
                </Surface>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <EmptyState
        title="There are no support articles yet"
        description="Nothing in the schema holds a help article or a support ticket, and no endpoint serves one, so this page has no knowledge base to search and no form that would reach anybody. Use a channel above and a person will answer."
      />
    </div>
  );
}

export const helpRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: '/help',
  component: HelpPage,
});

import { createRoute } from '@tanstack/react-router';
import { publicLayoutRoute } from './_public.js';
import { EmptyState } from '../components/empty-state.js';

function TermsPage() {
  return (
    <div className="px-6 py-10 sm:px-10">
      <EmptyState title="Terms of service" description="Legal terms are being drafted and will be published here before public launch." />
    </div>
  );
}

export const termsRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: '/terms',
  component: TermsPage,
});

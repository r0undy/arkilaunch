import { createRoute } from '@tanstack/react-router';
import { publicLayoutRoute } from './_public.js';
import { EmptyState } from '../components/empty-state.js';

function HelpPage() {
  return (
    <div className="px-6 py-10 sm:px-10">
      <EmptyState title="Help center" description="Support articles are being written. Contact us directly in the meantime." />
    </div>
  );
}

export const helpRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: '/help',
  component: HelpPage,
});

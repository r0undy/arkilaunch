import { createRoute } from '@tanstack/react-router';
import { publicLayoutRoute } from './_public.js';
import { EmptyState } from '../components/empty-state.js';

function PrivacyPage() {
  return (
    <div className="px-6 py-10 sm:px-10">
      <EmptyState
        title="Privacy policy"
        description="Our Data Privacy Act (RA 10173) disclosure is being finalized with counsel and will be published here before public launch."
      />
    </div>
  );
}

export const privacyRoute = createRoute({
  getParentRoute: () => publicLayoutRoute,
  path: '/privacy',
  component: PrivacyPage,
});

import { createRoute } from '@tanstack/react-router';
import { appLayoutRoute } from './_app.js';
import { requireRole } from '../lib/guards.js';
import { BrandingForm } from '../components/branding-form.js';
import { PageHeader } from '../components/page-header.js';

function BrandingPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Administration"
        title="Storefront branding"
        description="How your company looks on your storefront and in the ArkiLaunch directory."
      />
      <BrandingForm basePath="/tenants/me" />
    </div>
  );
}

// Owner and admin (tenant:manage server-side).
export const appBrandingRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/branding',
  beforeLoad: requireRole('admin', 'owner'),
  component: BrandingPage,
});

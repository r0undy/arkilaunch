export interface NavItem {
  label: string;
  to: string;
}

// One sidebar component, driven by which shell mounts it (Figma reuses the
// same sidebar chrome across roles with different item lists).
export const ACCOUNT_NAV: NavItem[] = [
  { label: 'Home Page', to: '/account' },
  { label: 'Equipments', to: '/equipment' },
  { label: 'Bookings', to: '/account/bookings' },
  { label: 'Applications', to: '/account/applications' },
  { label: 'Settings', to: '/account/settings' },
];

export const APP_NAV: NavItem[] = [
  { label: 'Dashboard', to: '/app' },
  { label: 'Deployment', to: '/app/deployment' },
  { label: 'Inventory', to: '/app/inventory' },
  { label: 'Quotes', to: '/app/quotes' },
  { label: 'Insights', to: '/app/insights' },
  { label: 'Incident Logs', to: '/app/incidents' },
  { label: 'Payments', to: '/app/payments' },
  { label: 'OCR Tool', to: '/app/ocr' },
  { label: 'Registration', to: '/app/registration' },
  { label: 'Manage Users', to: '/app/users' },
  { label: 'Settings', to: '/app/settings' },
];

// platform_admin-only items, appended by the shell that renders APP_NAV for
// that role (see _app.tsx) rather than filtered here -- keeps this file a
// plain data module with no role logic of its own.
export const PLATFORM_ADMIN_NAV: NavItem[] = [
  { label: 'Tenant Applications', to: '/app/platform-applications' },
];

export const FIELD_NAV: NavItem[] = [
  { label: 'Dashboard', to: '/field' },
  { label: 'Deployment', to: '/field/deployment' },
];

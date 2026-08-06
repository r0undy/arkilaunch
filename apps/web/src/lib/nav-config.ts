export interface NavItem {
  label: string;
  to: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

// One sidebar component, driven by which shell mounts it (Figma reuses the
// same sidebar chrome across roles with different item lists).
export const ACCOUNT_NAV: NavGroup[] = [
  {
    title: 'My account',
    items: [
      { label: 'Home', to: '/account' },
      { label: 'Browse equipment', to: '/equipment' },
      { label: 'My bookings', to: '/account/bookings' },
      { label: 'Applications', to: '/account/applications' },
      { label: 'Settings', to: '/account/settings' },
    ],
  },
];

// Grouped by work area, not by which API resource backs the screen --
// "Field logs" and "Onboarding" read the way Rhea talks about her day,
// not the way the system is built ("OCR Tool", "Registration").
export const APP_NAV: NavGroup[] = [
  {
    title: 'Dispatch',
    items: [
      { label: 'Dashboard', to: '/app' },
      { label: 'Sites & deployment', to: '/app/deployment' },
    ],
  },
  {
    title: 'Fleet',
    items: [{ label: 'Equipment', to: '/app/inventory' }],
  },
  {
    title: 'Billing',
    items: [
      { label: 'Field logs', to: '/app/ocr' },
      { label: 'Quotes', to: '/app/quotes' },
      { label: 'Invoices', to: '/app/payments' },
      { label: 'Reports', to: '/app/insights' },
      { label: 'Incident log', to: '/app/incidents' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'People', to: '/app/users' },
      { label: 'Rate cards', to: '/app/settings' },
      { label: 'Onboarding', to: '/app/registration' },
    ],
  },
];

// platform_admin-only items, appended by the shell that renders APP_NAV for
// that role (see _app.tsx) rather than filtered here -- keeps this file a
// plain data module with no role logic of its own.
export const PLATFORM_ADMIN_NAV: NavGroup[] = [
  {
    title: 'Platform',
    items: [{ label: 'Tenant applications', to: '/app/platform-applications' }],
  },
];

export const FIELD_NAV: NavItem[] = [
  { label: 'Dashboard', to: '/field' },
  { label: 'Deployment', to: '/field/deployment' },
];

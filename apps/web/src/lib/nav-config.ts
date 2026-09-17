import type { LucideIcon } from 'lucide-react';
import {
  Boxes,
  ClipboardList,
  FileText,
  LayoutDashboard,
  MapPin,
  Receipt,
  CalendarRange,
  Settings,
  ShieldAlert,
  ShoppingCart,
  Store,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  // Rendered beside the label in the sidebar; a destination is quicker to
  // find by its shape than by reading five words of Condensed caps.
  icon?: LucideIcon;
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
      { label: 'Home', to: '/account', icon: LayoutDashboard },
      { label: 'Browse equipment', to: '/equipment', icon: Boxes },
      { label: 'My bookings', to: '/account/bookings', icon: ShoppingCart },
      { label: 'Applications', to: '/account/applications', icon: FileText },
      { label: 'Settings', to: '/account/settings', icon: Settings },
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
      { label: 'Dashboard', to: '/app', icon: LayoutDashboard },
      { label: 'Sites and deployment', to: '/app/deployment', icon: MapPin },
    ],
  },
  {
    title: 'Fleet',
    items: [{ label: 'Equipment', to: '/app/inventory', icon: Boxes }],
  },
  {
    title: 'Billing',
    items: [
      { label: 'Field logs', to: '/app/ocr', icon: ClipboardList },
      { label: 'Quotes', to: '/app/quotes', icon: FileText },
      { label: 'Invoices', to: '/app/payments', icon: Receipt },
      { label: 'Weekly billing', to: '/app/billing/weekly', icon: CalendarRange },
      { label: 'Reports', to: '/app/insights', icon: TrendingUp },
      { label: 'Incident log', to: '/app/incidents', icon: ShieldAlert },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'People', to: '/app/users', icon: Users },
      { label: 'Rate cards', to: '/app/settings', icon: Settings },
      { label: 'Onboarding', to: '/app/registration', icon: UserPlus },
    ],
  },
];

// platform_admin-only items, appended by the shell that renders APP_NAV for
// that role (see _app.tsx) rather than filtered here -- keeps this file a
// plain data module with no role logic of its own.
export const PLATFORM_ADMIN_NAV: NavGroup[] = [
  {
    title: 'Platform',
    items: [{ label: 'Company applications', to: '/app/platform-applications', icon: Store }],
  },
];

export const FIELD_NAV: NavItem[] = [
  { label: 'Dashboard', to: '/field' },
  { label: 'Your sites', to: '/field/deployment' },
];

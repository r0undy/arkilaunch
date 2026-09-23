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
  Bell,
  UserCircle,
  ShieldAlert,
  ShoppingCart,
  Store,
  CalendarCheck,
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
  // A section root such as `/account` or `/app` is a prefix of every page in
  // its section, so prefix-matching lit it on all of them: the cart, the
  // checkout and the invoice all showed "Home" as the active destination.
  // `exact` means the blade shows on that URL and nowhere else.
  exact?: boolean;
  // Extra path prefixes this destination owns, for screens reached from it
  // that have no sidebar entry of their own (a detail page, a wizard).
  owns?: string[];
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
      { label: 'Home', to: '/account', icon: LayoutDashboard, exact: true },
      { label: 'Browse equipment', to: '/equipment', icon: Boxes },
      // The cart had no standing affordance at all: the only way back to it
      // was adding another machine, even though the items sit in
      // sessionStorage until the browser tab closes. Figma 168:1982 puts it
      // in the app bar; the sidebar is where this shell keeps destinations.
      { label: 'Cart', to: '/account/cart', icon: ShoppingCart },
      {
        label: 'My bookings',
        to: '/account/bookings',
        // Was ShoppingCart, which belongs to the cart. A booking is a
        // committed date, not a basket.
        icon: CalendarCheck,
        // Everything that happens to a booking after it exists. None of these
        // has a sidebar entry, and before `owns` they all lit "Home".
        owns: ['/account/checkout', '/account/invoices', '/account/negotiation'],
      },
      { label: 'Companies', to: '/account/companies', icon: Store },
      { label: 'Applications', to: '/account/applications', icon: FileText },
      { label: 'Notifications', to: '/account/notifications', icon: Bell },
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
      { label: 'Dashboard', to: '/app', icon: LayoutDashboard, exact: true },
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
      { label: 'Bookings', to: '/app/bookings', icon: ShoppingCart },
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
      { label: 'Notifications', to: '/app/notifications', icon: Bell },
      { label: 'My profile', to: '/app/profile', icon: UserCircle },
      { label: 'People', to: '/app/users', icon: Users },
      { label: 'Tickets', to: '/app/tickets', icon: ClipboardList },
      { label: 'Security logs', to: '/app/security-logs', icon: ShieldAlert },
      { label: 'Rate cards', to: '/app/settings', icon: Settings },
      { label: 'Onboarding', to: '/app/registration', icon: UserPlus },
      { label: 'Registration pending', to: '/app/registration/pending', icon: ClipboardList },
      { label: 'Registration verified', to: '/app/registration/verified', icon: ShieldAlert },
    ],
  },
];

// platform_admin-only items, appended by the shell that renders APP_NAV for
// that role (see _app.tsx) rather than filtered here -- keeps this file a
// plain data module with no role logic of its own.
export const PLATFORM_ADMIN_NAV: NavGroup[] = [
  {
    title: 'Platform',
    items: [
      { label: 'Company applications', to: '/app/platform-applications', icon: Store },
      { label: 'Pending companies', to: '/app/companies/pending', icon: ClipboardList },
      { label: 'Approved companies', to: '/app/companies/approved', icon: Store },
    ],
  },
];

export const FIELD_NAV: NavItem[] = [
  { label: 'Dashboard', to: '/field' },
  { label: 'Your sites', to: '/field/deployment' },
  { label: 'Notifications', to: '/field/notifications' },
  { label: 'My profile', to: '/field/profile' },
  { label: 'Settings', to: '/field/settings' },
];

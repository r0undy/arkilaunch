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
  Users,
  Truck,
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
      {
        label: 'My bookings',
        to: '/account/bookings',
        // Not ShoppingCart: a booking is a committed date, not a basket, and
        // the cart now lives in the app bar (Figma 185:1599) rather than here.
        icon: CalendarCheck,
        // The cart has no sidebar entry any more, so nothing would own its
        // URL -- and an unowned /account/* lights nothing at all.
        owns: ['/account/cart', '/account/checkout', '/account/invoices', '/account/negotiation'],
      },
      // One entry, not two: /account/companies redirected into the Figma
      // company list at /account/applications (251:1945).
      {
        label: 'Applications',
        to: '/account/applications',
        icon: FileText,
        // /account/companies redirects here, and its two surviving children --
        // the add-company form and the per-company detail page -- have no
        // entry of their own, so without this they would light nothing.
        owns: ['/account/companies'],
      },
      { label: 'Self-loading truck', to: '/account/trucks', icon: Truck },
      { label: 'Notifications', to: '/account/notifications', icon: Bell },
      { label: 'Settings', to: '/account/settings', icon: Settings },
    ],
  },
];

// Grouped by work area, not by which API resource backs the screen --
// "Field logs" reads the way Rhea talks about her day,
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
      { label: 'Truck service', to: '/app/trucks', icon: Truck },
      { label: 'Registration pending', to: '/app/registration/pending', icon: ClipboardList },
      { label: 'Registration verified', to: '/app/registration/verified', icon: ShieldAlert },
    ],
  },
];

// platform_admin's whole sidebar, used instead of APP_NAV (see _app.tsx).
// The role is cross-tenant: it onboards rental companies, it does not run
// one, so none of the Dispatch/Fleet/Billing tenant work is listed here.
// _app.tsx also redirects the role away from any /app page not listed.
export const PLATFORM_ADMIN_NAV: NavGroup[] = [
  {
    title: 'Companies',
    items: [
      { label: 'Applications', to: '/app/companies/pending', icon: ClipboardList },
      { label: 'Approved companies', to: '/app/companies/approved', icon: Store },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Notifications', to: '/app/notifications', icon: Bell },
      { label: 'My profile', to: '/app/profile', icon: UserCircle },
      { label: 'People', to: '/app/users', icon: Users },
      { label: 'Security logs', to: '/app/security-logs', icon: ShieldAlert },
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

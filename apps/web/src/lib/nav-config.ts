import type { LucideIcon } from 'lucide-react';
import type { RoleCode } from '@arkilaunch/shared';
import {
  Boxes,
  ClipboardList,
  FileText,
  LayoutDashboard,
  MapPin,
  Receipt,
  BadgePercent,
  CalendarRange,
  Settings,
  Bell,
  UserCircle,
  ShieldAlert,
  ShoppingCart,
  ShieldCheck,
  TriangleAlert,
  Store,
  ExternalLink,
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
  // Roles that may open it. Mirrors the route's own `beforeLoad` guard, so an
  // owner is not shown a page that only bounces them home. Unset = everyone
  // the shell admits.
  roles?: RoleCode[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
  // The shell heading already names this group in the customer menu.
  hideTitle?: boolean;
  // Rendered at the foot of the sidebar instead of in the list: the
  // destinations a user reaches for from anywhere (inbox, profile).
  pinned?: boolean;
}

// The groups as a given role sees them: items it cannot open are dropped,
// and a group left with nothing goes too.
export function navForRole(groups: NavGroup[], role: RoleCode | null): NavGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.roles || (role !== null && item.roles.includes(role))) }))
    .filter((group) => group.items.length > 0);
}

// One sidebar component, driven by which shell mounts it (Figma reuses the
// same sidebar chrome across roles with different item lists).
export const ACCOUNT_NAV: NavGroup[] = [
  {
    title: 'My account',
    hideTitle: true,
    items: [
      { label: 'Home', to: '/account', icon: LayoutDashboard, exact: true },
      { label: 'Browse equipment', to: '/equipment', icon: Boxes },
      { label: 'Self-loading truck', to: '/account/trucks', icon: Truck },
    ],
  },
  {
    title: 'Your activity',
    items: [
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
    ],
  },
  {
    title: 'Account tools',
    pinned: true,
    items: [
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
    title: 'Overview',
    items: [
      { label: 'Dashboard', to: '/app', icon: LayoutDashboard, exact: true },
      // The owner's home (guards.ts homeRouteForRole).
      { label: 'Reports', to: '/app/insights', icon: TrendingUp },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Bookings', to: '/app/bookings', icon: ShoppingCart },
      { label: 'Field logs', to: '/app/ocr', icon: ClipboardList },
      { label: 'Sites', to: '/app/deployment', icon: MapPin },
      { label: 'Incidents', to: '/app/incidents', icon: TriangleAlert },
    ],
  },
  {
    title: 'Fleet',
    items: [{ label: 'Equipment', to: '/app/inventory', icon: Boxes }],
  },
  {
    title: 'Billing',
    items: [
      { label: 'Invoices', to: '/app/payments', icon: Receipt },
      { label: 'Weekly billing', to: '/app/billing/weekly', icon: CalendarRange },
      { label: 'Coupons', to: '/app/coupons', icon: BadgePercent },
      { label: 'Price book', to: '/app/quotes', icon: FileText, roles: ['admin'] },
    ],
  },
  {
    title: 'Customers',
    items: [
      {
        label: 'Registrations',
        to: '/app/registration/pending',
        icon: ShieldCheck,
        // Pending and Verified are tabs of one page.
        owns: ['/app/registration'],
        roles: ['admin'],
      },
    ],
  },
  {
    title: 'Settings',
    items: [
      { label: 'Business settings', to: '/app/settings', icon: Settings, roles: ['admin'] },
      { label: 'Storefront branding', to: '/app/branding', icon: Store },
      { label: 'People', to: '/app/users', icon: Users, roles: ['admin'] },
    ],
  },
  {
    title: 'You',
    pinned: true,
    items: [
      { label: 'Notifications', to: '/app/notifications', icon: Bell },
      { label: 'My profile', to: '/app/profile', icon: UserCircle },
      { label: 'View storefront', to: '/', icon: ExternalLink, exact: true },
    ],
  },
];

// The /admin console's sidebar (routes/_admin.tsx, platform host only).
// The role is cross-tenant: it onboards rental companies, it does not run
// one, so none of the Dispatch/Fleet/Billing tenant work is listed here.
export const PLATFORM_ADMIN_NAV: NavGroup[] = [
  {
    title: 'Companies',
    items: [
      { label: 'Applications', to: '/admin/applications', icon: ClipboardList },
      { label: 'Companies', to: '/admin/companies', icon: Store },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Notifications', to: '/admin/notifications', icon: Bell },
      { label: 'My profile', to: '/admin/profile', icon: UserCircle },
      { label: 'People', to: '/admin/users', icon: Users },
      { label: 'Security logs', to: '/admin/security-logs', icon: ShieldAlert },
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

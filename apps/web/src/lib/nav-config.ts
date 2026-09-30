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
  TrendingDown,
  Users,
  Truck,
} from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon?: LucideIcon;
  // For a section root, which prefixes every page in its section.
  exact?: boolean;
  // Prefixes of screens with no sidebar entry of their own.
  owns?: string[];
  // Must mirror the route's `beforeLoad` guard.
  roles?: RoleCode[];
}

export interface NavGroup {
  title: string;
  items: NavItem[];
  hideTitle?: boolean;
  pinned?: boolean;
}

export function navForRole(groups: NavGroup[], role: RoleCode | null): NavGroup[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.roles || (role !== null && item.roles.includes(role))) }))
    .filter((group) => group.items.length > 0);
}

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
        icon: CalendarCheck,
        owns: ['/account/cart', '/account/checkout', '/account/invoices', '/account/negotiation'],
      },
      {
        label: 'Applications',
        to: '/account/applications',
        icon: FileText,
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

export const APP_NAV: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', to: '/app', icon: LayoutDashboard, exact: true },
      { label: 'Reports', to: '/app/insights', icon: TrendingUp },
      { label: 'Revenue leakage', to: '/app/insights/leakage', icon: TrendingDown },
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

# Change Record

**Title:** Console overhaul: a role-filtered sidebar grouped by workflow, summary cards with edit modals, and confirmations on the remaining one-click moves
**Project:** ArkiLaunch
**Date:** 2026-09-27
**Version:** 0.1
**Status:** `Applied` (repo, branch `feat/console-overhaul`)
**Trigger doc:** [build-arkilaunch.md](build-arkilaunch.md) §5.1 Brownfield Change Workflow (owner request to overhaul the tenant back office, `/app/*`, and align it with the customer portal)
**Docs touched by this record:** [dsd-arkilaunch.md](dsd-arkilaunch.md) §4 Surfaces + §4.1 Nav shell (materialized into `DESIGN.md`), [index.md](index.md) §2

---

## 1. Summary

After [cr-arkilaunch-console-polish](cr-arkilaunch-console-polish.md), the back office still had five problems.

- **The sidebar was the same for every role.** Owners saw People, Settings, Registration and Quotes, and each one redirected them away. On Quotes the page loaded, but its forms needed `pricing:manage`, so they rendered nothing.
- **Labels didn't match their pages.**
  - "Rate cards" opened office hours and billing.
  - The registration queue took two sidebar entries.
  - Profile and notifications sat in "Administration".
- **Long pages of always-open forms.**
  - Settings and the Price book stacked three or four long forms.
  - The invoice dialog could show two money forms at once.
  - The maintenance dialog stacked three forms under its schedules.
- **One-click moves that no dialog confirmed:**
  - removing a maintenance date block;
  - approving N clean days;
  - removing a site timekeeper;
  - verifying a company;
  - confirmed-by-phone;
  - approving a revised quote;
  - restoring a user's access;
  - removing a storefront image.
- **Paging that lied, and saves with no feedback.**
  - Field-log filters only filtered the loaded page.
  - The dashboard's unpaid list filtered the first page of all invoices.
  - Toll fee edits, timekeeper changes, rate card creation and date unblocking gave no feedback.

The Console tier is unchanged: amber, Plex, tight radii, borders first. Nothing in §2 changes.

## 2. Decisions

- **Sidebar:**
  - Six workflow groups (Overview, Operations, Fleet, Billing, Customers, Settings) and a pinned footer (Notifications, My profile, View storefront).
  - A `NavItem.roles` field mirrors the route's `beforeLoad` guard, and `navForRole()` drops what a role can't open.
  - Renames: Quotes → Price book, Rate cards → Business settings, Sites and deployment → Sites, Incident log → Incidents, Equipment and maintenance → Equipment.
- **`/app/quotes` gets `requireRole('admin')`.** Its endpoints already required `pricing:manage`, which owner doesn't have.
- **One Registrations page.** Pending and Verified are tabs, and both URLs are kept so existing links still work. Pending shows its count.
- **Summary card + edit modal** for every settings block (new `SummaryCard`, `EditButton`). The form logic doesn't change; only where it renders. A form whose GET fails now shows a retry instead of nothing.
- **Money actions get their own dialogs.** The invoice dialog shows one row of actions.
  - Change amount and Refund each open a dialog that states the change and can't be dismissed from the scrim; that dialog is the confirm.
  - Record cash keeps its ConfirmDialog.
- **Paging:**
  - Field-log `?equipment`/`?week` go to `GET /edtr` as `equipmentId`/`from`/`to`, and malformed values are dropped.
  - Invoices filter All / Unpaid / Paid on the server.
  - The dashboard asks for `status=issued`.
  - The DTR scanning list pages in the browser; its reference list is unpaged.
- **Not done:**
  - A confirm on "Confirm km". The value is re-editable and only reprices; the price itself is confirmed at "Accept price".
  - A confirm on Re-invite, which only resends an email.
  - Pagination on weekly billing (a printable statement), site-hub equipment and personnel (bounded per site) and the financial breakdown (a few rows).
  - Opening People to owners, even though the API grants them `user:manage`. The route stays admin-only, as before.

## 3. Repo changes

Web only. There are no API, schema or migration changes.

**Shell**
- `lib/nav-config.ts`: `APP_NAV`, `navForRole()`.
- `routes/_app.tsx`.
- `components/nav-group.tsx`: pinned footer.
- `components/app-bar.tsx`: count badges use `text-on-primary`.

**New components**
- `components/summary-card.tsx`.
- `EmptyState` and `DataPanel` take an optional icon.

**Pages**
- `app.settings.tsx`, `quotes.tsx`, `app.trucks.tsx`, `app.payments.tsx`, `components/maintenance-modal.tsx`, `app.site-hub.tsx`, `app.registration.queues.tsx`, `edtr.tsx`, `components/deployment-scan-list.tsx`, `app.index.tsx`, `app.insights.tsx`, `app.users.tsx`, `components/branding-form.tsx`, `components/booking-actions.tsx`.
- The eyebrows and titles of the remaining `/app` pages.

**Customer side**
- `account.applications.tsx` and `account.settings.tsx` used marketing-tier `rounded-mk-sm`/`bg-surface-mk`, which resolve to nothing outside `[data-tier="marketing"]`. They now use console tokens.

**Tests**
- `nav-pagination.test.tsx`: `navForRole`, plus a stale Pagination assertion fixed.
- `quotes.test.tsx`.
- e2e: `console-ui`, `maintenance`, `platform-console`, `kyc-review-crop`, `truck-request`, updated for the new dialogs and labels.

## 4. Verification

- `tsc` and ESLint are clean.
- Vitest: 43 files, 307 tests pass.
- The Playwright console specs were updated but not run locally: the local dev database's seeded accounts don't use the default seed password. CI's `console-e2e` job runs them against a fresh seed.

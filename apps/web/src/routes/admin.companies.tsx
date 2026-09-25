import { createRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CompanyStatus, PlatformCompany, PlatformCompanyListResponse } from '@arkilaunch/shared';
import { adminLayoutRoute } from './_admin.js';
import { DataPanel } from '../components/data-panel.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Button } from '../components/button.js';
import { Input } from '../components/input.js';
import { ConfirmDialog } from '../components/confirm-dialog.js';
import { Table, type TableColumn } from '../components/table.js';
import { useToast } from '../components/toast.js';
import { apiErrorText, apiGet, apiPatch } from '../lib/api-client.js';
import { formatDate, formatPeso } from '../lib/format.js';
import { tenantOrigin } from '../lib/host.js';

// Every rental company on the platform, seeded or approved (GET
// /tenants/companies, migration 0048), with its headline numbers, a link to
// its own site and an active/inactive switch. The site link is built from
// the current host, so it is `{slug}.localhost:5173` in dev and
// `{slug}.arkilaunch.tech` in production.
export const companiesQuery = () => ({
  queryKey: ['tenants', 'companies'] as const,
  queryFn: () => apiGet<PlatformCompanyListResponse>('/tenants/companies'),
});

function StatusBadge({ status }: { status: CompanyStatus }) {
  const active = status === 'active';
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        active ? 'bg-success/15 text-text' : 'bg-surface-sunk text-text-muted',
      ].join(' ')}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${active ? 'bg-success' : 'bg-border-strong'}`} />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

function StatusAction({ company }: { company: PlatformCompany }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const next: CompanyStatus = company.status === 'active' ? 'suspended' : 'active';
  const change = useMutation({
    mutationFn: () => apiPatch(`/tenants/${company.tenantId}/status`, { status: next }),
    onSuccess: async () => {
      toast.success(next === 'active' ? `${company.legalName} activated` : `${company.legalName} deactivated`);
      await queryClient.invalidateQueries({ queryKey: ['tenants', 'companies'] });
    },
    onError: (e) => toast.error('Could not change the status', apiErrorText(e)),
  });

  return (
    <>
      <Button
        variant={next === 'active' ? 'approve' : 'secondary'}
        size="field"
        onClick={() => setConfirming(true)}
        loading={change.isPending}
      >
        {next === 'active' ? 'Activate' : 'Deactivate'}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={next === 'active' ? `Activate ${company.legalName}?` : `Deactivate ${company.legalName}?`}
        body={
          next === 'active'
            ? 'Its storefront goes back online and its people can sign in again.'
            : 'Its storefront goes offline and nobody at the company can sign in until you activate it again. Data is kept.'
        }
        tone={next === 'active' ? 'approve' : 'danger'}
        confirmLabel={next === 'active' ? 'Activate' : 'Deactivate'}
        pending={change.isPending}
        onConfirm={async () => {
          await change.mutateAsync().catch(() => undefined);
          setConfirming(false);
        }}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}

const COLUMNS: TableColumn<PlatformCompany>[] = [
  {
    header: 'Company',
    cell: (row) => {
      const origin = tenantOrigin(row.slug);
      return (
        <span className="flex flex-col">
          <span className="font-semibold">{row.legalName}</span>
          <a
            href={origin}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-accent underline"
          >
            {origin.replace(/^https?:\/\//, '')}
          </a>
        </span>
      );
    },
  },
  { header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
  { header: 'People', cell: (row) => row.usersCount },
  { header: 'Customers', cell: (row) => row.customersCount },
  { header: 'Equipment', cell: (row) => row.equipmentCount },
  { header: 'Rentals', cell: (row) => row.rentalsCount },
  { header: 'Collected', cell: (row) => formatPeso(row.revenuePaid) },
  { header: 'Joined', cell: (row) => formatDate(row.createdAt) },
  {
    header: 'Actions',
    cell: (row) => (
      <span className="flex flex-wrap gap-2">
        <a
          href={tenantOrigin(row.slug)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-md border border-border-strong px-3 py-2 text-sm font-semibold text-text hover:bg-surface-sunk"
        >
          Open site<span className="sr-only"> for {row.legalName} (opens in a new tab)</span>
        </a>
        <StatusAction company={row} />
      </span>
    ),
  },
];

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Surface className="flex flex-col gap-1 p-4">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="font-display text-2xl font-semibold text-text">{value}</span>
      {detail && <span className="text-xs text-text-muted">{detail}</span>}
    </Surface>
  );
}

function Stats({ items }: { items: PlatformCompany[] }) {
  const active = items.filter((c) => c.status === 'active').length;
  const sum = (pick: (c: PlatformCompany) => number) => items.reduce((n, c) => n + pick(c), 0);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Companies" value={String(items.length)} detail={`${active} active, ${items.length - active} inactive`} />
      <Stat label="Equipment listed" value={String(sum((c) => c.equipmentCount))} />
      <Stat label="Rentals" value={String(sum((c) => c.rentalsCount))} />
      <Stat label="Collected" value={formatPeso(sum((c) => Number(c.revenuePaid)))} detail="Paid payments, all companies" />
    </div>
  );
}

function CompaniesTable({ items }: { items: PlatformCompany[] }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const rows = q ? items.filter((c) => c.legalName.toLowerCase().includes(q) || c.slug.includes(q)) : items;
  return (
    <div className="flex flex-col gap-3">
      <div className="max-w-sm">
        <Input label="Search companies" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">No companies match &ldquo;{query}&rdquo;.</p>
      ) : (
        <Table columns={COLUMNS} rows={rows} rowKey={(row) => row.tenantId} />
      )}
    </div>
  );
}

function CompaniesPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Companies"
        title="Companies"
        description="Every rental company on ArkiLaunch. Open a company's site, or deactivate it to take it offline."
      />
      <DataPanel
        title="Companies"
        options={companiesQuery()}
        emptyTitle="No companies yet"
        emptyDescription="Companies appear here once you approve their application."
        isEmpty={(data) => data.items.length === 0}
        render={(data) => (
          <div className="flex flex-col gap-4">
            <Stats items={data.items} />
            <CompaniesTable items={data.items} />
          </div>
        )}
      />
    </div>
  );
}

export const adminCompaniesRoute = createRoute({
  getParentRoute: () => adminLayoutRoute,
  path: '/admin/companies',
  component: CompaniesPage,
});

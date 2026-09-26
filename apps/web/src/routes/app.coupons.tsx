import { createRoute } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CouponCreate, CouponResponse } from '@arkilaunch/shared';
import { appLayoutRoute } from './_app.js';
import { couponsQueries } from '../lib/queries.js';
import { ApiError, apiErrorText, apiPatch, apiPost } from '../lib/api-client.js';
import { Button } from '../components/button.js';
import { DataPanel } from '../components/data-panel.js';
import { Input } from '../components/input.js';
import { PageHeader } from '../components/page-header.js';
import { Select } from '../components/select.js';
import { Surface } from '../components/surface.js';
import { Table, type TableColumn } from '../components/table.js';
import { useToast } from '../components/toast.js';
import { formatDate, formatPeso } from '../lib/format.js';

// cr-arkilaunch-coupons.md: the company's coupon codes. A coupon comes off
// the rent at checkout, never the consumable deposit. Codes are never edited
// once issued (customers may already hold them); a wrong one is switched off
// and a new one made.

const discountText = (c: CouponResponse) =>
  c.discountType === 'percent' ? `${c.discountValue}% off rent` : `${formatPeso(c.discountValue)} off rent`;

function CreateCoupon() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('');
  const [expires, setExpires] = useState('');
  const [maxUses, setMaxUses] = useState('');
  const [oncePerCustomer, setOncePerCustomer] = useState(true);

  const create = useMutation({
    mutationFn: (body: CouponCreate) => apiPost<CouponResponse>('/coupons', body),
    onSuccess: (coupon) => {
      toast.success('Coupon created', `${coupon.code} is ready to share.`);
      setCode('');
      setValue('');
      setExpires('');
      setMaxUses('');
      void queryClient.invalidateQueries({ queryKey: couponsQueries.list().queryKey });
    },
    onError: (err) =>
      toast.error(
        'Could not create the coupon',
        err instanceof ApiError && err.message === 'coupon_code_taken' ? 'That code is already in use.' : apiErrorText(err),
      ),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate({
      code: code.trim().toUpperCase(),
      discountType,
      discountValue: Number(value),
      // End of the chosen day, local time.
      expiresAt: expires ? new Date(`${expires}T23:59:59`) : null,
      maxUses: maxUses ? Number(maxUses) : null,
      oncePerCustomer,
    });
  }

  return (
    <Surface radius="md" elevation="sm" className="p-5">
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-3">
        <Input
          label="Code"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          pattern="[A-Za-z0-9_\-]{3,32}"
          hint="3 to 32 letters, digits, - or _"
        />
        <Select label="Discount" value={discountType} onChange={(e) => setDiscountType(e.target.value as 'percent' | 'fixed')}>
          <option value="percent">Percent of rent</option>
          <option value="fixed">Fixed amount (PHP)</option>
        </Select>
        <Input
          label={discountType === 'percent' ? 'Percent' : 'Amount (PHP)'}
          required
          numeric
          type="number"
          min="0.01"
          step="0.01"
          max={discountType === 'percent' ? '100' : undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <Input label="Expires (optional)" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
        <Input
          label="Max total uses (optional)"
          numeric
          type="number"
          min="1"
          step="1"
          value={maxUses}
          onChange={(e) => setMaxUses(e.target.value)}
        />
        <label className="flex items-center gap-2 self-end pb-3 text-sm text-text">
          <input
            type="checkbox"
            checked={oncePerCustomer}
            onChange={(e) => setOncePerCustomer(e.target.checked)}
            className="h-5 w-5 accent-[var(--color-primary)]"
          />
          Once per customer company
        </label>
        <div className="md:col-span-3">
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create coupon
          </Button>
        </div>
      </form>
    </Surface>
  );
}

function ActiveToggle({ coupon }: { coupon: CouponResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => apiPatch<CouponResponse>(`/coupons/${coupon.id}`, { active: !coupon.active }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: couponsQueries.list().queryKey }),
    onError: (err) => toast.error('Could not update the coupon', apiErrorText(err)),
  });
  return (
    <Button variant="ghost" loading={toggle.isPending} onClick={() => toggle.mutate()}>
      {coupon.active ? 'Switch off' : 'Switch on'}
    </Button>
  );
}

const COLUMNS: TableColumn<CouponResponse>[] = [
  { header: 'Code', cell: (c) => <span className="font-mono text-text">{c.code}</span> },
  { header: 'Discount', cell: discountText },
  {
    header: 'Uses',
    cell: (c) => `${c.redeemedCount}${c.maxUses ? ` of ${c.maxUses}` : ''}${c.oncePerCustomer ? ', once per company' : ''}`,
  },
  { header: 'Expires', cell: (c) => (c.expiresAt ? formatDate(c.expiresAt) : 'Never') },
  { header: 'Status', cell: (c) => (c.active ? 'Active' : 'Off') },
  { header: '', cell: (c) => <ActiveToggle coupon={c} />, align: 'right' },
];

function CouponsPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Billing"
        title="Coupons"
        description="Codes your customers enter at checkout. A coupon comes off the rent, never the consumable deposit."
      />
      <CreateCoupon />
      <DataPanel
        title="Coupons"
        options={couponsQueries.list()}
        emptyTitle="No coupons yet"
        emptyDescription="Create one above and share the code with a customer."
        isEmpty={(data) => data.length === 0}
        render={(data) => <Table columns={COLUMNS} rows={data} rowKey={(c) => c.id} />}
      />
    </div>
  );
}

export const appCouponsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/app/coupons',
  component: CouponsPage,
});

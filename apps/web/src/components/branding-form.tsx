import { useState, type FormEvent } from 'react';
import { tenantsQueries } from '../lib/queries.js';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MAX_UPLOAD_BYTES, type TenantBranding, type TenantBrandingUpdateRequest } from '@arkilaunch/shared';
import { apiDelete, apiErrorText, apiPatch, apiPostForm } from '../lib/api-client.js';
import { prepareUpload } from '../lib/image-compression.js';
import { onPrimaryFor } from '../lib/brand.js';
import { Button } from './button.js';
import { ConfirmDialog } from './confirm-dialog.js';
import { Input } from './input.js';
import { Select } from './select.js';
import { Surface } from './surface.js';
import { useToast } from './toast.js';

const DEFAULT_PRIMARY = '#f2a100';
const DEFAULT_HEADER = '#f5f2eb';
const HEX = /^#[0-9a-f]{6}$/i;

type Draft = { [K in keyof TenantBrandingUpdateRequest]: string };

function toDraft(b: TenantBranding): Draft {
  return {
    primaryColor: b.primaryColor ?? '',
    headerColor: b.headerColor ?? '',
    font: b.font ?? '',
    facebookUrl: b.facebookUrl ?? '',
    messengerUrl: b.messengerUrl ?? '',
    tagline: b.tagline ?? '',
    about: b.about ?? '',
    phone: b.phone ?? '',
    contactEmail: b.contactEmail ?? '',
    address: b.address ?? '',
    city: b.city ?? '',
    province: b.province ?? '',
  };
}

function toRequest(d: Draft): TenantBrandingUpdateRequest {
  const orNull = (v: string) => (v.trim() === '' ? null : v.trim());
  return {
    primaryColor: orNull(d.primaryColor.toLowerCase()),
    headerColor: orNull(d.headerColor.toLowerCase()),
    font: d.font === 'inter' || d.font === 'plex' ? d.font : null,
    facebookUrl: orNull(d.facebookUrl),
    messengerUrl: orNull(d.messengerUrl),
    tagline: d.tagline.trim(),
    about: orNull(d.about),
    phone: orNull(d.phone),
    contactEmail: orNull(d.contactEmail),
    address: orNull(d.address),
    city: orNull(d.city),
    province: orNull(d.province),
  };
}

// A PNG keeps its transparency; the compressor would re-encode it to JPEG.
async function prepareImage(file: File): Promise<File> {
  if (file.type === 'image/png' && file.size <= MAX_UPLOAD_BYTES) return file;
  return prepareUpload(file);
}

function ImageField({
  label,
  hint,
  url,
  basePath,
  kind,
  onChanged,
}: {
  label: string;
  hint: string;
  url: string | null;
  basePath: string;
  kind: 'logo' | 'hero' | 'icon' | 'login';
  onChanged: () => void;
}) {
  const toast = useToast();
  const upload = useMutation({
    mutationFn: async (file: File) => apiPostForm(`${basePath}/branding/${kind}`, {}, await prepareImage(file)),
    onSuccess: () => {
      onChanged();
      toast.success(`${label} updated`);
    },
    onError: (e) => toast.error(`Could not upload the ${label.toLowerCase()}`, apiErrorText(e)),
  });
  const remove = useMutation({
    mutationFn: () => apiDelete(`${basePath}/branding/${kind}`),
    onSuccess: () => {
      onChanged();
      toast.success(`${label} removed`);
    },
    onError: (e) => toast.error(`Could not remove the ${label.toLowerCase()}`, apiErrorText(e)),
  });
  const inputId = `branding-${kind}`;
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-text">
        {label}
      </label>
      {url ? (
        <img
          src={url}
          alt={`Current ${label.toLowerCase()}`}
          className={
            kind === 'hero'
              ? 'aspect-[3/1] w-full max-w-md rounded-sm object-cover'
              : kind === 'login'
                ? 'aspect-[3/4] w-full max-w-[200px] rounded-sm object-cover'
                : kind === 'icon'
                  ? 'size-16 rounded-sm object-contain'
                  : 'h-16 w-auto max-w-[200px] object-contain'
          }
        />
      ) : (
        <p className="text-sm text-text-muted">None yet.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg"
          disabled={upload.isPending}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
          className="max-w-full text-sm text-text-muted file:mr-3 file:min-h-10 file:rounded-sm file:border file:border-border-strong file:bg-surface file:px-3 file:text-sm file:font-semibold file:text-text"
        />
        {url && (
          <Button variant="ghost" loading={remove.isPending} onClick={() => setConfirmingRemove(true)}>
            Remove
          </Button>
        )}
        <ConfirmDialog
          open={confirmingRemove}
          tone="danger"
          title={`Remove the ${label.toLowerCase()}?`}
          body={<p>Your storefront and emails stop showing it straight away. You can upload another at any time.</p>}
          confirmLabel="Remove it"
          pending={remove.isPending}
          onConfirm={async () => {
            await remove.mutateAsync().catch(() => undefined);
            setConfirmingRemove(false);
          }}
          onCancel={() => setConfirmingRemove(false)}
        />
      </div>
      <p className="text-sm text-text-muted">{hint}</p>
    </div>
  );
}

function ColorField({
  id,
  label,
  hint,
  value,
  fallback,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  fallback: string;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
        </label>
        <input
          id={id}
          type="color"
          value={HEX.test(value) ? value.toLowerCase() : fallback}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-20 cursor-pointer rounded-sm border border-border-strong bg-surface"
        />
      </div>
      <Input
        label={`${label} (hex)`}
        value={value}
        placeholder={fallback}
        pattern="#[0-9a-fA-F]{6}"
        onChange={(e) => onChange(e.target.value)}
        hint={hint}
      />
    </div>
  );
}

export function BrandingForm({ basePath }: { basePath: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const brandingQuery = tenantsQueries.branding(basePath);
  const saved = useQuery(brandingQuery);
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = draft ?? (saved.data ? toDraft(saved.data) : null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: brandingQuery.queryKey });
    void queryClient.invalidateQueries({ queryKey: ['catalog', 'tenant'] });
  };

  const save = useMutation({
    mutationFn: (d: Draft) => apiPatch<TenantBranding>(`${basePath}/branding`, toRequest(d)),
    onSuccess: () => {
      setDraft(null);
      refresh();
      toast.success('Branding saved');
    },
    onError: (e) => toast.error('Could not save branding', apiErrorText(e)),
  });

  if (saved.isError) {
    return <p className="text-sm text-text-muted">Could not load branding: {apiErrorText(saved.error)}</p>;
  }
  if (!saved.data || !current) return null;

  const edit = (patch: Partial<Draft>) => setDraft({ ...current, ...patch });
  const primary = HEX.test(current.primaryColor) ? current.primaryColor.toLowerCase() : DEFAULT_PRIMARY;
  const header = HEX.test(current.headerColor) ? current.headerColor.toLowerCase() : null;
  const mark = saved.data.iconUrl ?? saved.data.logoUrl;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (current) save.mutate(current);
  }

  return (
    <div className="flex flex-col gap-5">
      <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-4" aria-label="Preview">
        <h2 className="text-heading-md text-text">Preview</h2>
        <div className="overflow-hidden rounded-sm border border-border">
          <div
            className={['flex items-center gap-3 px-4 py-3', header ? '' : 'text-text'].join(' ')}
            style={header ? { backgroundColor: header, color: onPrimaryFor(header) } : undefined}
          >
            {mark && <img src={mark} alt="" className="h-8 w-auto max-w-[120px] object-contain" />}
            <span className="text-heading-md">{saved.data.legalName}</span>
          </div>
          <div className="flex flex-wrap items-center gap-4 border-t border-border p-4">
            <span className="min-w-0 flex-1 text-sm text-text-muted">{current.tagline || 'Your tagline'}</span>
            <span
              className="inline-flex min-h-10 items-center rounded-sm px-4 text-sm font-semibold"
              style={{ backgroundColor: primary, color: onPrimaryFor(primary) }}
            >
              Rent now
            </span>
          </div>
        </div>
      </Surface>

      <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-4" aria-label="Images">
        <h2 className="text-heading-md text-text">Logo, icon and images</h2>
        <div className="grid gap-6 md:grid-cols-2">
          <ImageField
            label="Logo"
            hint="PNG or JPEG. A transparent PNG looks best."
            url={saved.data.logoUrl}
            basePath={basePath}
            kind="logo"
            onChanged={refresh}
          />
          <ImageField
            label="Icon"
            hint="Square PNG, 180px or larger. Your browser tab icon and the mark in the top bar; your logo is used until you add one."
            url={saved.data.iconUrl}
            basePath={basePath}
            kind="icon"
            onChanged={refresh}
          />
          <div className="md:col-span-2">
            <ImageField
              label="Hero image"
              hint="Optional. A wide photo shown at the top of your storefront."
              url={saved.data.heroUrl}
              basePath={basePath}
              kind="hero"
              onChanged={refresh}
            />
          </div>
          <div className="md:col-span-2">
            <ImageField
              label="Sign-in image"
              hint="Optional. A tall photo of your fleet or a job site, shown beside your sign-in and sign-up forms. Your hero image is used until you add one."
              url={saved.data.loginUrl}
              basePath={basePath}
              kind="login"
              onChanged={refresh}
            />
          </div>
        </div>
      </Surface>

      <Surface radius="md" elevation="sm" className="p-4" aria-label="Details">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <h2 className="text-heading-md text-text">Details</h2>
          <Input
            label="Company name"
            value={saved.data.legalName}
            readOnly
            disabled
            hint="Your registered name can't be changed here."
          />
          <ColorField
            id="branding-color"
            label="Brand color"
            value={current.primaryColor}
            fallback={DEFAULT_PRIMARY}
            onChange={(primaryColor) => edit({ primaryColor })}
            hint="Used for buttons and highlights. Leave empty for the ArkiLaunch default."
          />
          <ColorField
            id="branding-header-color"
            label="Header color"
            value={current.headerColor}
            fallback={DEFAULT_HEADER}
            onChange={(headerColor) => edit({ headerColor })}
            hint="The bar across the top of your storefront and workspace. Leave empty to keep the default."
          />
          <Select
            id="branding-font"
            label="Font"
            value={current.font}
            onChange={(e) => edit({ font: e.target.value })}
            hint="Headings and text on your storefront and workspace. Figures always keep the monospace face."
          >
            <option value="">Inter (ArkiLaunch default)</option>
            <option value="plex">IBM Plex</option>
          </Select>
          <Input
            label="Tagline"
            required
            maxLength={160}
            value={current.tagline}
            onChange={(e) => edit({ tagline: e.target.value })}
            hint="One line under your name on the storefront and in the directory."
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="branding-about" className="text-sm font-medium text-text">
              About
            </label>
            <textarea
              id="branding-about"
              rows={4}
              maxLength={2000}
              value={current.about}
              onChange={(e) => edit({ about: e.target.value })}
              className="rounded-input border border-border-strong bg-surface px-3 py-2 text-text"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Phone"
              type="tel"
              maxLength={50}
              value={current.phone}
              onChange={(e) => edit({ phone: e.target.value })}
            />
            <Input
              label="Contact email"
              type="email"
              maxLength={200}
              value={current.contactEmail}
              onChange={(e) => edit({ contactEmail: e.target.value })}
            />
            <Input
              label="Street address"
              maxLength={500}
              value={current.address}
              onChange={(e) => edit({ address: e.target.value })}
            />
            <Input label="City" maxLength={100} value={current.city} onChange={(e) => edit({ city: e.target.value })} />
            <Input
              label="Province"
              maxLength={100}
              value={current.province}
              onChange={(e) => edit({ province: e.target.value })}
              hint="Customers can filter the ArkiLaunch directory by province."
            />
            <Input
              label="Facebook page"
              type="url"
              maxLength={300}
              value={current.facebookUrl}
              placeholder="https://www.facebook.com/yourpage"
              onChange={(e) => edit({ facebookUrl: e.target.value })}
              hint="Shown as a Follow us link in your storefront footer."
            />
            <Input
              label="Messenger link"
              type="url"
              maxLength={300}
              value={current.messengerUrl}
              placeholder="https://m.me/yourpage"
              onChange={(e) => edit({ messengerUrl: e.target.value })}
              hint="Customers can negotiate here or in the in-app chat. Leave blank to use the in-app chat only."
            />
          </div>
          <div>
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!draft}>
              Save branding
            </Button>
          </div>
        </form>
      </Surface>
    </div>
  );
}

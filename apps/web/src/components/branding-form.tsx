import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TenantBranding, TenantBrandingUpdateRequest } from '@arkilaunch/shared';
import { apiDelete, apiErrorText, apiGet, apiPatch, apiPostForm } from '../lib/api-client.js';
import { MAX_UPLOAD_BYTES, prepareUpload } from '../lib/image-compression.js';
import { onPrimaryFor } from '../lib/tenant.js';
import { Button } from './button.js';
import { Input } from './input.js';
import { Surface } from './surface.js';
import { useToast } from './toast.js';

const DEFAULT_PRIMARY = '#f2a100';

type Draft = { [K in keyof TenantBrandingUpdateRequest]: string };

function toDraft(b: TenantBranding): Draft {
  return {
    primaryColor: b.primaryColor ?? '',
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
    tagline: d.tagline.trim(),
    about: orNull(d.about),
    phone: orNull(d.phone),
    contactEmail: orNull(d.contactEmail),
    address: orNull(d.address),
    city: orNull(d.city),
    province: orNull(d.province),
  };
}

// A PNG logo keeps its transparency; anything else goes through the shared
// compressor (which re-encodes to JPEG).
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
  kind: 'logo' | 'hero';
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
            kind === 'logo'
              ? 'h-16 w-auto max-w-[200px] object-contain'
              : 'aspect-[3/1] w-full max-w-md rounded-sm object-cover'
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
          <Button variant="ghost" loading={remove.isPending} onClick={() => remove.mutate()}>
            Remove
          </Button>
        )}
      </div>
      <p className="text-sm text-text-muted">{hint}</p>
    </div>
  );
}

// The company's public storefront branding. `basePath` is /tenants/me for
// the company's own owner/admin, /tenants/{id} for a platform admin. The
// legal name is shown but never editable (the API rejects it too).
export function BrandingForm({ basePath }: { basePath: string }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const queryKey = ['branding', basePath] as const;
  const saved = useQuery({ queryKey, queryFn: () => apiGet<TenantBranding>(`${basePath}/branding`) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = draft ?? (saved.data ? toDraft(saved.data) : null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey });
    // The storefront on this host re-reads its branding too.
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
  const primary = /^#[0-9a-f]{6}$/i.test(current.primaryColor) ? current.primaryColor.toLowerCase() : DEFAULT_PRIMARY;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (current) save.mutate(current);
  }

  return (
    <div className="flex flex-col gap-5">
      <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-4" aria-label="Preview">
        <h2 className="font-display text-base font-semibold text-text">Preview</h2>
        <div className="flex flex-wrap items-center gap-4 rounded-sm border border-border p-4">
          {saved.data.logoUrl && (
            <img src={saved.data.logoUrl} alt="" className="h-10 w-auto max-w-[140px] object-contain" />
          )}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-display text-lg font-semibold text-text">{saved.data.legalName}</span>
            <span className="text-sm text-text-muted">{current.tagline || 'Your tagline'}</span>
          </div>
          <span
            className="inline-flex min-h-10 items-center rounded-sm px-4 text-sm font-semibold"
            style={{ backgroundColor: primary, color: onPrimaryFor(primary) }}
          >
            Rent now
          </span>
        </div>
      </Surface>

      <Surface radius="md" elevation="sm" className="flex flex-col gap-4 p-4" aria-label="Images">
        <h2 className="font-display text-base font-semibold text-text">Logo and hero image</h2>
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
            label="Hero image"
            hint="Optional. A wide photo shown at the top of your storefront."
            url={saved.data.heroUrl}
            basePath={basePath}
            kind="hero"
            onChanged={refresh}
          />
        </div>
      </Surface>

      <Surface radius="md" elevation="sm" className="p-4" aria-label="Details">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <h2 className="font-display text-base font-semibold text-text">Details</h2>
          <Input
            label="Company name"
            value={saved.data.legalName}
            readOnly
            disabled
            hint="Your registered name can't be changed here."
          />
          <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
            <div className="flex flex-col gap-1">
              <label htmlFor="branding-color" className="text-sm font-medium text-text">
                Brand color
              </label>
              <input
                id="branding-color"
                type="color"
                value={primary}
                onChange={(e) => edit({ primaryColor: e.target.value })}
                className="h-11 w-20 cursor-pointer rounded-sm border border-border-strong bg-surface"
              />
            </div>
            <Input
              label="Brand color (hex)"
              value={current.primaryColor}
              placeholder={DEFAULT_PRIMARY}
              pattern="#[0-9a-fA-F]{6}"
              onChange={(e) => edit({ primaryColor: e.target.value })}
              hint="Used for buttons and highlights. Leave empty for the ArkiLaunch default."
            />
          </div>
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
              className="rounded-sm border border-border-strong bg-surface px-3 py-2 text-text"
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

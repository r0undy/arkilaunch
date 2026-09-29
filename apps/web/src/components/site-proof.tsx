import { useState } from 'react';
import { Camera, CircleCheck, Upload, type LucideIcon } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  SITE_DOCUMENT_LABELS,
  SITE_PROOF_TYPES,
  type CustomerSiteResponse,
  type SiteDocument,
  type SiteDocumentType,
} from '@arkilaunch/shared';
import { apiErrorText, apiGet, apiPostForm } from '../lib/api-client.js';
import { formatDate, formatStatus } from '../lib/format.js';
import { useToast } from './toast.js';
import { prepareUpload } from '../lib/image-compression.js';
import { Button } from './button.js';
import { Select } from './select.js';

const label = (type: string) => SITE_DOCUMENT_LABELS[type as SiteDocumentType] ?? formatStatus(type);

export function uploadSiteDocument(siteId: string, documentType: SiteDocumentType, file: File) {
  return apiPostForm(`/me/sites/${siteId}/documents`, { documentType }, file);
}

// A file input shown as a pill button, so the pick is hard to miss inside
// the site dialog; once chosen, the file's name shows beside it.
function FilePick({
  id,
  text,
  icon: Icon,
  accept,
  capture,
  ariaLabel,
  onFile,
}: {
  id: string;
  text: string;
  icon: LucideIcon;
  accept: string;
  capture?: 'environment';
  ariaLabel?: string;
  onFile: (file: File | null) => void;
}) {
  const [name, setName] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border border-border-strong bg-surface px-6 py-2.5 text-sm font-medium text-text hover:bg-surface-sunk focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring">
        <Icon aria-hidden className="h-4 w-4" />
        {name ? 'Change file' : text}
        <input
          id={id}
          type="file"
          accept={accept}
          capture={capture}
          aria-label={ariaLabel}
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            setName(file?.name ?? null);
            if (!file) return onFile(null);
            // Shrunk at pick time, so a local refusal never lands after the site is created.
            prepareUpload(file).then(onFile, () => onFile(file));
          }}
        />
      </label>
      {name && (
        <span className="inline-flex min-w-0 items-center gap-1 text-sm text-text">
          <CircleCheck aria-hidden className="h-4 w-4 shrink-0 text-success" />
          <span className="truncate">{name}</span>
        </span>
      )}
    </div>
  );
}

// The two picks a site's proof needs: a photo taken there, and one paper
// tying the company to it. Used when adding a site and to finish one.
export function SiteProofFields({
  proofType,
  onProofTypeChange,
  onProofFile,
  onPhotoFile,
  idPrefix,
}: {
  proofType: SiteDocumentType;
  onProofTypeChange: (type: SiteDocumentType) => void;
  onProofFile: (file: File | null) => void;
  onPhotoFile: (file: File | null) => void;
  idPrefix: string;
}) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm font-medium text-text">Proof of the site</legend>
      <p className="text-sm text-text-muted">
        Needed before the site can take a booking or a truck trip, so the rental team knows the site is real and yours to work
        on.
      </p>
      <Select
        label="Document"
        id={`${idPrefix}-proof-type`}
        value={proofType}
        onChange={(e) => onProofTypeChange(e.target.value as SiteDocumentType)}
      >
        {SITE_PROOF_TYPES.map((type) => (
          <option key={type} value={type}>
            {label(type)}
          </option>
        ))}
      </Select>
      <FilePick
        id={`${idPrefix}-proof-file`}
        text="Upload document"
        icon={Upload}
        accept="image/*,application/pdf"
        ariaLabel={label(proofType)}
        onFile={onProofFile}
      />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-text">Photo of the site</p>
        <p className="text-sm text-text-muted">Taken at the site: the gate, signage or the work area.</p>
        <FilePick
          id={`${idPrefix}-photo`}
          text="Take or choose a photo"
          icon={Camera}
          accept="image/*"
          capture="environment"
          ariaLabel="Photo of the site"
          onFile={onPhotoFile}
        />
      </div>
    </fieldset>
  );
}

// A customer site still missing its proof: say what is missing and take it.
export function SiteProofStatus({ site }: { site: CustomerSiteResponse }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [proofType, setProofType] = useState<SiteDocumentType>('building_permit');
  const [proof, setProof] = useState<File | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const hasPhoto = site.documents.some((d) => d.documentType === 'site_photo' && d.status !== 'rejected');
  const hasPaper = site.documents.some((d) => d.documentType !== 'site_photo' && d.status !== 'rejected');
  const send = useMutation({
    mutationFn: async () => {
      if (proof && !hasPaper) await uploadSiteDocument(site.id, proofType, proof);
      if (photo && !hasPhoto) await uploadSiteDocument(site.id, 'site_photo', photo);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me', 'sites'] });
      toast.success('Site proof uploaded');
    },
    onError: (e) => toast.error('Not uploaded', apiErrorText(e)),
  });
  if (site.proofComplete) return <span className="text-xs text-text-muted">Proof on file</span>;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-error">Needs its proof before it can take a booking or a truck trip.</p>
      <SiteProofFields
        idPrefix={`site-${site.id}`}
        proofType={proofType}
        onProofTypeChange={setProofType}
        onProofFile={hasPaper ? () => undefined : setProof}
        onPhotoFile={hasPhoto ? () => undefined : setPhoto}
      />
      <Button
        variant="secondary"
        className="self-start"
        loading={send.isPending}
        disabled={(!hasPaper && !proof) || (!hasPhoto && !photo)}
        onClick={() => send.mutate()}
      >
        Upload proof
      </Button>
    </div>
  );
}

// Staff: a booking's or truck trip's site proof, each opened on a 300s
// signed URL. Missing proof is said plainly.
export function SiteProofAdmin({ siteId }: { siteId: string }) {
  const toast = useToast();
  const docs = useQuery({
    queryKey: ['sites', siteId, 'documents'],
    queryFn: () => apiGet<{ documents: SiteDocument[]; proofComplete: boolean }>(`/sites/${siteId}/documents`),
  });
  async function open(documentId: string) {
    try {
      const { url } = await apiGet<{ url: string }>(`/sites/${siteId}/documents/${documentId}/url`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error('Could not open the document', apiErrorText(e));
    }
  }
  if (docs.isPending) return <p className="text-sm text-text-muted">Loading site proof...</p>;
  if (docs.isError) return <p className="text-sm text-error">{apiErrorText(docs.error)}</p>;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className={docs.data.proofComplete ?'text-text' : 'text-error'}>
        {docs.data.proofComplete ? 'Site proof on file' : 'Site proof incomplete'}
      </p>
      {docs.data.documents.length === 0 && <p className="text-text-muted">No documents uploaded for this site.</p>}
      {docs.data.documents.map((doc) => (
        <button
          key={doc.id}
          type="button"
          onClick={() => void open(doc.id)}
          className="min-h-11 text-left text-primary underline"
        >
          {label(doc.documentType)} <span className="text-text-muted">&middot; {formatDate(doc.createdAt)}</span>
        </button>
      ))}
    </div>
  );
}

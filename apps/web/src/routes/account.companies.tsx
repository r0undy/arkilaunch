import { createRoute, Link, useBlocker, useNavigate } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  findSameCompany,
  isPrimaryRegistration,
  PH_ID_TYPE_CODES,
  PH_ID_TYPES,
  type PhIdTypeCode,
  normalizeSecNumber,
  normalizeTin,
  type CompanyResponse,
  type KycScanResponse,
  type PrimaryRegistrationType,
} from '@arkilaunch/shared';
import { accountLayoutRoute } from './_account.js';
import { prepareUpload } from '../lib/image-compression.js';
import { companyStatusLabel } from '../lib/cart-validation.js';
import { apiErrorText, apiPost, apiPostForm } from '../lib/api-client.js';
import { companiesQueries } from '../lib/queries.js';
import { PageHeader } from '../components/page-header.js';
import { Surface } from '../components/surface.js';
import { Alert } from '../components/alert.js';
import { Button, buttonClass } from '../components/button.js';
import { Input } from '../components/input.js';
import { MobileInput } from '../components/mobile-input.js';
import { EmptyState } from '../components/empty-state.js';
import { CompanyCard, DOC_LABELS } from '../components/company-card.js';
import { CaptureField } from '../components/capture-field.js';
import { IdCropDialog } from '../components/id-crop-dialog.js';
import { Skeleton } from '../components/skeleton.js';
import { useToast } from '../components/toast.js';
import { Select } from '../components/select.js';

// What the customer confirmed off their ID. Sent with the ID upload so the
// reviewer sees it beside what the OCR read. `idType` is which Philippine
// primary ID it is (QA 15); its number is checked in that card's format.
export interface IdDetails {
  idType: PhIdTypeCode;
  firstName: string;
  middleName: string;
  lastName: string;
  idNumber: string;
  birthDate: string;
  sex: '' | 'M' | 'F';
  address: string;
}

const EMPTY_ID: IdDetails = {
  idType: 'philsys',
  firstName: '',
  middleName: '',
  lastName: '',
  idNumber: '',
  birthDate: '',
  sex: '',
  address: '',
};

// Only non-empty values: the API validates each field it is sent.
function filled(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields)
      .map(([k, v]) => [k, v.trim()])
      .filter(([, v]) => v),
  );
}

// Upload each document, one request each, all at once. Shared by the new-company form
// and the "upload what is still missing" screen.
async function uploadDocuments(
  companyId: string,
  files: {
    governmentId: File | null;
    idDetails: IdDetails;
    selfie?: File | null;
    registration: File | null;
    registrationType: PrimaryRegistrationType;
    dti: File | null;
    dtiNumber?: string;
  },
): Promise<void> {
  const uploads: [string, File | null, Record<string, string>][] = [
    ['government_id', files.governmentId, filled({ ...files.idDetails })],
    ['selfie_with_id', files.selfie ?? null, {}],
    [files.registrationType, files.registration, {}],
    ['dti_certificate', files.dti, filled({ dtiNumber: files.dtiNumber ?? '' })],
  ];
  // Side by side: each is its own request and its own row.
  await Promise.all(
    uploads
      .filter(([, file]) => file)
      .map(([documentType, file, confirmed]) =>
        apiPostForm(`/me/companies/${companyId}/documents`, { documentType, ...confirmed }, file!),
      ),
  );
}

// One document at a time, in order. Both used to sit on the same screen,
// which asked a customer to frame two different papers at once; the ID is
// the gate, and the customer checks what it says before moving on.
export type DocStep = 'government_id' | 'company_registration';
type WizardStep = DocStep | 'id_details' | 'details';
const WIZARD_STEPS: readonly WizardStep[] = ['government_id', 'id_details', 'company_registration', 'details'];

export const DOC_STEPS: { type: DocStep; label: string; hint: string }[] = [
  {
    type: 'government_id',
    label: 'Government-issued ID',
    hint: 'Step 1 of 3. Any Philippine primary ID: National ID (PhilSys), passport, driver\'s license, UMID, SSS, PRC, postal, voter\'s or TIN ID. The whole card must be in the photo, clear and unexpired; the rental team checks it with the issuer. Add a selfie holding the ID so they can match you to it.',
  },
  {
    type: 'company_registration',
    label: 'Primary registration',
    hint: 'Step 3 of 3. Your BIR Certificate of Registration (Form 2303) or SEC certificate. A DTI business name certificate can be added as a secondary document.',
  },
];

const REGISTRATION_OPTIONS: { value: PrimaryRegistrationType; label: string }[] = [
  { value: 'bir_cor', label: 'BIR Certificate of Registration (Form 2303)' },
  { value: 'sec_certificate', label: 'SEC Certificate of Incorporation' },
];

// A capture that opens the cropper for every photo. The photo as taken is
// kept so "Crop again" starts from the full frame rather than re-cropping a
// crop. PDFs are never cropped.
function CroppableCapture({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: File | null;
  onChange: (file: File | null) => void;
}) {
  const [original, setOriginal] = useState<File | null>(null);
  const [cropping, setCropping] = useState(false);

  function onPick(file: File | null) {
    const image = file?.type.startsWith('image/') ? file : null;
    setOriginal(image);
    onChange(file);
    if (image) setCropping(true);
  }

  return (
    <>
      <CaptureField id={id} label={label} accept="image/*,application/pdf" value={value} onChange={onPick} />
      {original && value && (
        <div>
          <Button type="button" variant="secondary" onClick={() => setCropping(true)}>
            Crop again
          </Button>
        </div>
      )}
      {cropping && original && (
        <IdCropDialog
          file={original}
          onCancel={() => setCropping(false)}
          onCropped={(cropped) => {
            onChange(cropped);
            setCropping(false);
          }}
        />
      )}
    </>
  );
}

function DocumentStep({
  step,
  value,
  onChange,
  registrationType,
  onRegistrationTypeChange,
  dti,
  onDtiChange,
  showPrimary = true,
  showDti = true,
  selfie = null,
  onSelfieChange,
  idType,
  onIdTypeChange,
}: {
  step: (typeof DOC_STEPS)[number];
  value: File | null;
  onChange: (file: File | null) => void;
  registrationType: PrimaryRegistrationType;
  onRegistrationTypeChange: (type: PrimaryRegistrationType) => void;
  dti: File | null;
  onDtiChange: (file: File | null) => void;
  // A rejected company re-uploads what cures it; a submitted one nothing.
  showPrimary?: boolean;
  showDti?: boolean;
  selfie?: File | null;
  onSelfieChange?: (file: File | null) => void;
  // Which primary ID is being captured, on the ID step.
  idType?: PhIdTypeCode;
  onIdTypeChange?: (type: PhIdTypeCode) => void;
}) {
  const isRegistration = step.type === 'company_registration';
  const idLabel = idType ? PH_ID_TYPES[idType].label : step.label;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-text-muted">{step.hint}</p>
      {isRegistration && showPrimary && (
        <Select
          label="Document type"
          id="registration-type"
          value={registrationType}
          onChange={(e) => onRegistrationTypeChange(e.target.value as PrimaryRegistrationType)}
        >
          {REGISTRATION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      )}
      {!isRegistration && idType && onIdTypeChange && (
        <Select label="ID type" id="id-type" value={idType} onChange={(e) => onIdTypeChange(e.target.value as PhIdTypeCode)}>
          {PH_ID_TYPE_CODES.map((code) => (
            <option key={code} value={code}>
              {PH_ID_TYPES[code].label}
            </option>
          ))}
        </Select>
      )}
      {(!isRegistration || showPrimary) && (
        <CroppableCapture
          id={`doc-${step.type}`}
          label={isRegistration ? DOC_LABELS[registrationType]! : idLabel}
          value={value}
          onChange={onChange}
        />
      )}
      {!isRegistration && onSelfieChange && (
        <label className="flex flex-col gap-1 text-sm font-medium text-text">
          Selfie holding your ID
          <span className="font-normal text-text-muted">
            Hold the ID beside your face, both clearly visible. The rental team only compares it with the ID photo; it is
            never read by a machine.
          </span>
          <input
            id="doc-selfie_with_id"
            type="file"
            accept="image/*"
            capture="user"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              // Shrunk like every other capture: a raw 12 MP selfie was the
              // slowest upload on submit.
              if (!file) return onSelfieChange(null);
              prepareUpload(file).then(onSelfieChange, () => onSelfieChange(file));
            }}
            className="min-h-11 text-sm"
          />
          {selfie && <span className="font-normal text-text-muted">{selfie.name}</span>}
        </label>
      )}
      {isRegistration && showDti && (
        <CroppableCapture
          id="doc-dti_certificate"
          label="DTI Business Name certificate (secondary, optional)"
          value={dti}
          onChange={onDtiChange}
        />
      )}
    </div>
  );
}

// Reads a document the customer just captured and hands back what it saw,
// for them to correct. A failed or unavailable scan is not an error the
// customer has to act on -- the form simply opens empty.
async function scanForSuggestions(
  file: File,
  documentType: string,
  idType?: PhIdTypeCode,
): Promise<Pick<KycScanResponse, 'suggestions' | 'confidence' | 'layoutRecognized'> | null> {
  try {
    const scan = await apiPostForm<KycScanResponse>('/me/kyc/scan', { documentType, ...(idType ? { idType } : {}) }, file);
    return scan.extractionAvailable ? scan : null;
  } catch {
    return null;
  }
}

// Below this some filled-in detail may be misread, so the customer is asked
// to check it against the card. A typing hint only: every ID still goes to
// staff review whatever it scored (the 0.90 RFC-2 gate is separate).
const LEGIBLE_CONFIDENCE = 0.85;

interface IdScan {
  details: IdDetails;
  read: boolean;
  unclear: boolean;
}

async function scanId(file: File, idType: PhIdTypeCode): Promise<IdScan> {
  const scan = await scanForSuggestions(file, 'government_id', idType);
  const s = scan?.suggestions;
  const details: IdDetails = {
    idType,
    firstName: s?.firstName ?? '',
    middleName: s?.middleName ?? '',
    lastName: s?.lastName ?? '',
    idNumber: s?.idNumber ?? '',
    // The date input only takes YYYY-MM-DD; anything else is left for the
    // customer to pick.
    birthDate: s?.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(s.birthDate) ? s.birthDate : '',
    sex: s?.sex === 'M' || s?.sex === 'F' ? s.sex : '',
    address: s?.address ?? '',
  };
  return {
    details,
    read: Object.entries(details).some(([key, v]) => key !== 'idType' && Boolean(v)),
    unclear: scan?.confidence != null && scan.confidence < LEGIBLE_CONFIDENCE,
  };
}

// The customer checks every detail the scan read off their ID -- or types
// it, when the scan could not -- before a reviewer ever sees it.
function IdReviewStep({
  scan,
  value,
  onChange,
  onBack,
  onConfirm,
}: {
  scan: IdScan;
  value: IdDetails;
  onChange: (value: IdDetails) => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const set = (patch: Partial<IdDetails>) => onChange({ ...value, ...patch });
  const card = PH_ID_TYPES[value.idType];
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm();
      }}
    >
      <p className="text-sm text-text-muted">
        Step 2 of 3. Check your {card.label} details. The rental team compares them with the card
        before verifying.
      </p>
      <p role="status" className="text-sm text-text-muted">
        {scan.read
          ? 'Filled in from your ID. Fix anything that does not match the card exactly.'
          : 'We could not read your ID, so please type the details from the card.'}
      </p>
      {scan.unclear && (
        <Alert type="warning">
          Some details were hard to read. Check each one against your card before continuing.
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          label="First name"
          required
          maxLength={200}
          autoComplete="given-name"
          value={value.firstName}
          onChange={(e) => set({ firstName: e.target.value })}
        />
        <Input
          label="Middle name"
          maxLength={200}
          autoComplete="additional-name"
          value={value.middleName}
          onChange={(e) => set({ middleName: e.target.value })}
        />
        <Input
          label="Last name"
          required
          maxLength={200}
          autoComplete="family-name"
          value={value.lastName}
          onChange={(e) => set({ lastName: e.target.value })}
        />
      </div>
      <Input
        label={card.numberLabel}
        required
        placeholder={card.placeholder}
        pattern={card.re.source.replace(/^\^|\$$/g, '')}
        title={`As printed on the card, like ${card.placeholder}`}
        hint={`As printed on your ${card.label}.`}
        value={value.idNumber}
        onChange={(e) => set({ idNumber: e.target.value })}
        onBlur={(e) => set({ idNumber: card.normalize(e.target.value) })}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Date of birth"
          type="date"
          autoComplete="bday"
          value={value.birthDate}
          onChange={(e) => set({ birthDate: e.target.value })}
        />
        <Select
          label="Sex"
          value={value.sex}
          onChange={(e) => set({ sex: e.target.value as IdDetails['sex'] })}
        >
          <option value="">Select</option>
          <option value="M">Male</option>
          <option value="F">Female</option>
        </Select>
      </div>
      <Input
        label="Address on the ID"
        maxLength={500}
        autoComplete="street-address"
        value={value.address}
        onChange={(e) => set({ address: e.target.value })}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">
          Next: company registration
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Retake ID
        </Button>
      </div>
    </form>
  );
}

// Figma 582:3946 / 168:2442 "Add New Company".
function NewCompanyPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [companyName, setCompanyName] = useState('');
  const [tin, setTin] = useState('');
  const [secNumber, setSecNumber] = useState('');
  const [dtiNumber, setDtiNumber] = useState('');
  const [billingAddress, setBillingAddress] = useState('');
  const [contactMobile, setContactMobile] = useState('');
  const [governmentId, setGovernmentId] = useState<File | null>(null);
  const [idDetails, setIdDetails] = useState<IdDetails>(EMPTY_ID);
  const [idScan, setIdScan] = useState<IdScan | null>(null);
  const [registration, setRegistration] = useState<File | null>(null);
  const [registrationType, setRegistrationType] = useState<PrimaryRegistrationType>('bir_cor');
  const [dti, setDti] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Scan first, type last: the documents are captured in order, the ID is
  // checked on its own step, and the form opens on what the registration
  // scans read, for final edits. The step lives in the URL (?step=) so the
  // browser's Back and Forward move between steps; the page stays mounted,
  // so what was captured survives the move (QA 17).
  const { step: urlStep } = accountCompanyNewRoute.useSearch();
  const setStage = (step: WizardStep) => void navigate({ to: '/account/companies/new', search: { step } });
  // A reload loses the ID photo and its scan: the ID check step then starts over.
  const chosenStage: WizardStep = urlStep === 'id_details' && !idScan ? 'government_id' : (urlStep ?? 'government_id');
  // Leaving the wizard (not moving between its steps) with anything captured
  // asks first; the photos cannot be put back. A finished submit is free to go.
  const submitted = useRef(false);
  const dirty = Boolean(governmentId || registration || dti || selfie || companyName || billingAddress);
  useBlocker({
    shouldBlockFn: ({ current, next }) =>
      !submitted.current &&
      dirty &&
      next.pathname !== current.pathname &&
      !window.confirm('Leave this application? The documents you captured will be lost.'),
    enableBeforeUnload: () => dirty && !submitted.current,
  });
  // The ID is captured once per login: with one on file (any of this
  // account's companies) the ID steps are skipped and the server reuses it.
  const mine = useQuery(companiesQueries.mine()).data ?? [];
  const idOnFile = mine.some((c) => c.documents.some((d) => d.documentType === 'government_id'));
  const stage = idOnFile && (chosenStage === 'government_id' || chosenStage === 'id_details') ? 'company_registration' : chosenStage;
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<boolean | null>(null);
  // The registration scan did not read as the paper picked (layoutRecognized).
  const [wrongPaper, setWrongPaper] = useState(false);

  // Each number comes only from the paper that prints it.
  const showTin = registrationType === 'bir_cor';
  const showSec = registrationType === 'sec_certificate';
  const showDti = Boolean(dti);
  // Already applied for? Checked as the details fill in, against the list
  // this page already has; the server refuses it too.
  const existing = findSameCompany(
    { companyName, tin: showTin ? tin : null, secNumber: showSec ? secNumber : null },
    mine,
  );

  async function checkId() {
    if (!governmentId) return;
    setScanning(true);
    const scan = await scanId(governmentId, idDetails.idType);
    setIdScan(scan);
    setIdDetails(scan.details);
    setScanning(false);
    setStage('id_details');
  }

  async function scanThenEdit() {
    setScanning(true);
    const [primary, secondary] = await Promise.all([
      registration ? scanForSuggestions(registration, registrationType) : null,
      dti ? scanForSuggestions(dti, 'dti_certificate') : null,
    ]);
    const p = primary?.suggestions;
    const d = secondary?.suggestions;
    const name = p?.companyName ?? d?.companyName;
    if (name) setCompanyName(name);
    if (p?.tin) setTin(p.tin);
    if (p?.secNumber) setSecNumber(p.secNumber);
    if (d?.dtiNumber) setDtiNumber(d.dtiNumber);
    const address = p?.address ?? d?.address;
    if (address && !billingAddress) setBillingAddress(address);
    setScanned(Boolean(name || p?.tin || p?.secNumber || d?.dtiNumber));
    setWrongPaper(primary?.layoutRecognized === false);
    setScanning(false);
    setStage('details');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    let created: CompanyResponse | null = null;
    try {
      created = await apiPost<CompanyResponse>('/me/companies', {
        companyName,
        billingAddress,
        contactMobile,
        ...filled({ tin: showTin ? normalizeTin(tin) : '', secNumber: showSec ? normalizeSecNumber(secNumber) : '' }),
      });
      await uploadDocuments(created.id, {
        governmentId,
        idDetails,
        selfie,
        registration,
        registrationType,
        dti,
        dtiNumber: showDti ? dtiNumber : '',
      });
      // Not awaited: the list page refetches on its own; waiting here only
      // held the spinner for one more round trip.
      void queryClient.invalidateQueries({ queryKey: ['me', 'companies'] });
      toast.success('Company added', 'The rental team will verify it. You can request quotes now.');
      submitted.current = true;
      // replace: Back from the list must not reopen a finished application.
      await navigate({ to: '/account/applications', replace: true });
    } catch (err) {
      // The company exists even if an upload failed; say so, and send the
      // customer to finish the upload rather than create a duplicate.
      if (created) {
        await queryClient.invalidateQueries({ queryKey: ['me', 'companies'] });
        toast.error('Company saved, but a document did not upload', apiErrorText(err));
        submitted.current = true;
        await navigate({ to: '/account/applications', replace: true });
        return;
      }
      setError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (stage === 'id_details' && idScan) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Add a company" description="Check your ID details." />
        <Surface radius="md" elevation="sm" className="flex max-w-2xl flex-col gap-4 p-6">
          <IdReviewStep
            scan={idScan}
            value={idDetails}
            onChange={setIdDetails}
            onBack={() => setStage('government_id')}
            onConfirm={() => setStage('company_registration')}
          />
        </Surface>
      </div>
    );
  }

  if (stage !== 'details') {
    const step = DOC_STEPS.find((s) => s.type === stage)!;
    const file = stage === 'government_id' ? governmentId : registration;
    const setFile = stage === 'government_id' ? setGovernmentId : setRegistration;
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title="Add a company"
          description="Scan the documents first; you will check the details at the end."
        />
        <Surface radius="md" elevation="sm" className="flex max-w-2xl flex-col gap-4 p-6">
          <DocumentStep
            step={step}
            value={file}
            onChange={setFile}
            registrationType={registrationType}
            onRegistrationTypeChange={setRegistrationType}
            dti={dti}
            onDtiChange={setDti}
            selfie={selfie}
            onSelfieChange={setSelfie}
            idType={idDetails.idType}
            onIdTypeChange={(idType) => setIdDetails({ ...idDetails, idType })}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!file || scanning}
              loading={scanning}
              onClick={() => (stage === 'government_id' ? checkId() : scanThenEdit())}
            >
              {stage === 'government_id' ? 'Next: check your ID details' : 'Next: check the details'}
            </Button>
            {stage === 'company_registration' && !idOnFile ? (
              <Button variant="ghost" onClick={() => setStage('id_details')}>
                Back
              </Button>
            ) : (
              <Link to="/account/companies" className={buttonClass('ghost')}>Cancel</Link>
            )}
          </div>
          <p className="text-xs text-text-muted">
            Both documents are needed before the rental team can verify this company.
          </p>
        </Surface>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Add a company"
        description="Check what we read from your documents, and fix anything that is wrong."
      />
      <Surface radius="md" elevation="sm" className="flex max-w-2xl flex-col gap-4 p-6">
        <form onSubmit={submit} className="flex flex-col gap-4">
          {scanned !== null && (
            <p role="status" className="text-sm text-text-muted">
              {scanned
                ? 'Filled in from your registration documents. Check every field before you submit.'
                : 'We could not read your registration documents, so please fill this in yourself.'}
            </p>
          )}
          {wrongPaper && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-warning px-3 py-2 text-sm text-text">
              <span>
                We couldn't recognise this as a {DOC_LABELS[registrationType]}. Check it's the right paper and the
                whole page is in the photo.
              </span>
              <Button type="button" variant="ghost" onClick={() => setStage('company_registration')}>
                Retake
              </Button>
            </div>
          )}
          {existing && (
            <Alert type="warning" header={`You already applied for ${existing.companyName}`}>
              It is {companyStatusLabel(existing) || 'verified'}.{' '}
              <Link to="/account/companies/$companyId" params={{ companyId: existing.id }} className="underline">
                Open it
              </Link>
              {existing.kycStatus === 'rejected' ? ' to fix and reapply' : ''} instead of adding it again.
            </Alert>
          )}
          <Input
            label="Company name"
            required
            maxLength={200}
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
          {showTin && (
            <Input
              label="TIN"
              required
              inputMode="numeric"
              placeholder="000-000-000-00000"
              pattern="\d{3}-\d{3}-\d{3}(-\d{3}|-\d{5})?"
              title="9, 12 or 14 digits: 000-000-000, 000-000-000-000 or 000-000-000-00000"
              hint="From your BIR Form 2303, with the branch code as printed."
              value={tin}
              onChange={(e) => setTin(e.target.value)}
              onBlur={(e) => setTin(normalizeTin(e.target.value))}
            />
          )}
          {showSec && (
            <Input
              label="SEC registration number"
              required
              maxLength={24}
              placeholder="CS201912345"
              pattern="([A-Za-z]{1,3}\d{3}-?\d{4,9}|\d{10,13}(-\d{2})?)"
              title="As printed on the SEC certificate, e.g. CS201912345 or 2021060012345-00"
              hint="From your SEC certificate (Company Reg. No.)."
              value={secNumber}
              onChange={(e) => setSecNumber(e.target.value)}
              onBlur={(e) => setSecNumber(normalizeSecNumber(e.target.value))}
            />
          )}
          {showDti && (
            <Input
              label="DTI business name number"
              maxLength={13}
              inputMode="numeric"
              placeholder="1234567"
              pattern="([Bb][Nn]-?)?\d{6,10}"
              title="The Business Name No. on the DTI certificate, 6 to 10 digits"
              hint="From your DTI certificate. Optional."
              value={dtiNumber}
              onChange={(e) => setDtiNumber(e.target.value.trim())}
            />
          )}
          <Input
            label="Complete billing address"
            required
            maxLength={500}
            value={billingAddress}
            onChange={(e) => setBillingAddress(e.target.value)}
          />
          <MobileInput label="Contact mobile" required value={contactMobile} onChange={setContactMobile} />
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-text-muted">
            <span>
              Scanned: {idOnFile ? 'ID on file' : governmentId ? PH_ID_TYPES[idDetails.idType].label : 'no ID'}, {DOC_LABELS[registrationType]}
              {dti ? ' and DTI certificate' : ''}.
            </span>
            <Button type="button" variant="ghost" onClick={() => setStage(idOnFile ? 'company_registration' : 'government_id')}>
              Rescan
            </Button>
          </div>
          <label className="flex items-start gap-2 text-sm text-text">
            <input
              type="checkbox"
              required
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-primary)]"
            />
            <span>
              I confirm these documents are genuine and consent to the rental team reviewing them
              under the{' '}
              <Link to="/privacy" className="underline">
                Privacy Policy
              </Link>
              .
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-error">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={busy} disabled={!accepted || Boolean(existing)}>
              Submit
            </Button>
            <Link to="/account/companies" className={buttonClass('ghost')}>
              Cancel
            </Link>
          </div>
          <p className="text-xs text-text-muted">
            You can upload the documents later, but payment opens only once the company is verified.
          </p>
        </form>
      </Surface>
    </div>
  );
}

function CompanyDocumentsPage() {
  const { companyId } = accountCompanyDocumentsRoute.useParams();
  const company = useQuery(companiesQueries.mine()).data?.find((row) => row.id === companyId);
  // A document already on file is replaced only after a rejection, as its
  // cure; one never uploaded can always be added.
  const mayUpload = (test: (type: string) => boolean) => {
    const onFile = company?.documents.filter((d) => test(d.documentType)) ?? [];
    return onFile.length === 0 || (company!.kycStatus === 'rejected' && !company!.rejection?.final);
  };
  const idOpen = mayUpload((t) => t === 'government_id');
  const primaryOpen = mayUpload(isPrimaryRegistration);
  const dtiOpen = mayUpload((t) => t === 'dti_certificate');
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [governmentId, setGovernmentId] = useState<File | null>(null);
  const [idDetails, setIdDetails] = useState<IdDetails>(EMPTY_ID);
  const [idScan, setIdScan] = useState<IdScan | null>(null);
  const [registration, setRegistration] = useState<File | null>(null);
  const [registrationType, setRegistrationType] = useState<PrimaryRegistrationType>('bir_cor');
  const [dti, setDti] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Same one-at-a-time order as adding a company, ID check included. The
  // registration is not scanned here: the company already exists, so there
  // is no company form left to prefill.
  const [chosenStage, setStage] = useState<DocStep | 'id_details'>('government_id');
  // With the ID locked there is no ID step: straight to the registration.
  const stage = !idOpen && chosenStage !== 'company_registration' ? 'company_registration' : chosenStage;
  // "Next: company registration" (the ID check) and "Upload" sit in the
  // same spot. A fast double-tap -- or any input lag between the two taps
  // registering -- lands the second tap on "Upload" the instant it replaces
  // "Next", submitting before the customer ever sees the registration step.
  // Guard submit() against firing within advanceGraceMs of the stage flip
  // that put "Upload" under the customer's finger.
  const stageChangedAt = useRef(0);
  const advanceGraceMs = 400;

  const step = DOC_STEPS.find((s) => s.type === stage);
  const file = stage === 'government_id' ? governmentId : registration;
  const setFile = stage === 'government_id' ? setGovernmentId : setRegistration;

  async function checkId() {
    if (!governmentId) return;
    setScanning(true);
    const scan = await scanId(governmentId, idDetails.idType);
    setIdScan(scan);
    setIdDetails(scan.details);
    setScanning(false);
    setStage('id_details');
  }

  function advanceToRegistration() {
    stageChangedAt.current = Date.now();
    setStage('company_registration');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Both document steps share this <form> (step 1's "Next" is
    // type="button"). A stray submit event firing before the registration
    // step must never upload a partial set and navigate away -- that reads
    // as the flow being "stuck" and leaves an orphaned government_id
    // document behind.
    if (stage !== 'company_registration') return;
    if (Date.now() - stageChangedAt.current < advanceGraceMs) return;
    setBusy(true);
    try {
      await uploadDocuments(companyId, {
        governmentId,
        idDetails,
        selfie,
        registration,
        registrationType,
        dti,
      });
      await queryClient.invalidateQueries({ queryKey: ['me', 'companies'] });
      toast.success('Documents uploaded');
      await navigate({ to: '/account/applications' });
    } catch (err) {
      toast.error('Upload failed', apiErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Upload documents" />
      <Surface radius="md" elevation="sm" className="flex max-w-2xl flex-col gap-4 p-6">
        {!idOpen && !primaryOpen && !dtiOpen ? (
          <div role="status" className="flex flex-col gap-2">
            <p className="font-medium text-text">Waiting for admin review</p>
            <p className="text-sm text-text-muted">
              Your documents are with the rental team and cannot be changed unless they ask you to.
            </p>
            <Link to="/account/companies/$companyId" params={{ companyId }} className={buttonClass('secondary')}>Back to the company</Link>
          </div>
        ) : stage === 'id_details' && idScan ? (
          <IdReviewStep
            scan={idScan}
            value={idDetails}
            onChange={setIdDetails}
            onBack={() => setStage('government_id')}
            onConfirm={advanceToRegistration}
          />
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            {step && (
              <DocumentStep
                step={step}
                value={file}
                onChange={setFile}
                registrationType={registrationType}
                onRegistrationTypeChange={setRegistrationType}
                dti={dti}
                onDtiChange={setDti}
                selfie={selfie}
                onSelfieChange={setSelfie}
                idType={idDetails.idType}
                onIdTypeChange={(idType) => setIdDetails({ ...idDetails, idType })}
                showPrimary={primaryOpen}
                showDti={dtiOpen}
              />
            )}
            <div className="flex flex-wrap gap-2">
              {stage === 'government_id' ? (
                <Button
                  type="button"
                  variant="primary"
                  disabled={!governmentId || scanning}
                  loading={scanning}
                  onClick={checkId}
                >
                  Next: check your ID details
                </Button>
              ) : (
                <>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={busy}
                    disabled={!governmentId && !registration && !dti}
                  >
                    Upload
                  </Button>
                  {idOpen && (
                    <Button type="button" variant="ghost" onClick={() => setStage('id_details')}>
                      Back
                    </Button>
                  )}
                </>
              )}
            </div>
          </form>
        )}
      </Surface>
    </div>
  );
}

// What "Manage" on a company card opens (Figma 251:1945). /account/companies
// itself is gone -- the Figma list lives at /account/applications and
// router.tsx redirects the old path there.
function CompanyDetailPage() {
  const { companyId } = accountCompanyDetailRoute.useParams();
  const companies = useQuery(companiesQueries.mine());
  const company = companies.data?.find((row) => row.id === companyId);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={company?.companyName ?? 'Company'}
        description="Verification, documents and the sites you deliver to."
        actions={
          <Link to="/account/applications" className={buttonClass('secondary')}>Back to applications</Link>
        }
      />
      {companies.isPending && <Skeleton label="Loading this company" rows={2} />}
      {companies.isError && <p className="text-sm text-error">{apiErrorText(companies.error)}</p>}
      {companies.isSuccess &&
        (company ? (
          <CompanyCard company={company} />
        ) : (
          <EmptyState
            title="Company not found"
            description="It may have been removed, or it belongs to another account."
          />
        ))}
    </div>
  );
}

export const accountCompanyDetailRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/companies/$companyId',
  component: CompanyDetailPage,
});

export const accountCompanyNewRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/companies/new',
  validateSearch: (search: Record<string, unknown>): { step?: WizardStep } =>
    WIZARD_STEPS.includes(search.step as WizardStep) ? { step: search.step as WizardStep } : {},
  component: NewCompanyPage,
});

export const accountCompanyDocumentsRoute = createRoute({
  getParentRoute: () => accountLayoutRoute,
  path: '/account/companies/$companyId/documents',
  component: CompanyDocumentsPage,
});

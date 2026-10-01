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
import { ApplicationsPage } from './account.applications.js';
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
import { Modal } from '../components/modal.js';

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

// Only non-empty values: the API validates every field it is sent.
function filled(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields)
      .map(([k, v]) => [k, v.trim()])
      .filter(([, v]) => v),
  );
}

async function uploadDocuments(
  companyId: string,
  files: {
    governmentId: File | null;
    idDetails: IdDetails;
    registration: File | null;
    registrationType: PrimaryRegistrationType;
    dti: File | null;
    dtiNumber?: string;
  },
): Promise<void> {
  const uploads: [string, File | null, Record<string, string>][] = [
    ['government_id', files.governmentId, filled({ ...files.idDetails })],
    [files.registrationType, files.registration, {}],
    ['dti_certificate', files.dti, filled({ dtiNumber: files.dtiNumber ?? '' })],
  ];
  await Promise.all(
    uploads
      .filter(([, file]) => file)
      .map(([documentType, file, confirmed]) =>
        apiPostForm(`/me/companies/${companyId}/documents`, { documentType, ...confirmed }, file!),
      ),
  );
}

export type DocStep = 'government_id' | 'company_registration';
type WizardStep = DocStep | 'id_type' | 'id_details' | 'registration_type' | 'dti_certificate' | 'details';
const WIZARD_STEPS: readonly WizardStep[] = [
  'id_type', 'government_id', 'id_details', 'registration_type',
  'company_registration', 'dti_certificate', 'details',
];

export const DOC_STEPS: { type: DocStep; label: string; hint: string }[] = [
  {
    type: 'government_id',
    label: 'Government-issued ID',
    hint: 'Step 1 of 3. Any Philippine primary ID: National ID (PhilSys), passport, driver\'s license, UMID, SSS, PRC, postal, voter\'s or TIN ID. The whole card must be in the photo, clear and unexpired; the rental team checks it with the issuer.',
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

function CroppableCapture({
  id,
  label,
  value,
  onChange,
  smartScan = false,
  onAccepted,
}: {
  id: string;
  label: string;
  value: File | null;
  onChange: (file: File | null) => void;
  smartScan?: boolean;
  onAccepted?: ((file: File) => void) | undefined;
}) {
  const [original, setOriginal] = useState<File | null>(null);
  const [cropping, setCropping] = useState(false);

  function onPick(file: File | null) {
    if (smartScan) { onChange(file); return; }
    const image = file?.type.startsWith('image/') ? file : null;
    setOriginal(image);
    onChange(file);
    if (image) setCropping(true);
  }

  return (
    <>
      <CaptureField id={id} label={label} accept="image/*,application/pdf" value={value} onChange={onPick} scanner={smartScan} onAccepted={onAccepted} />
      {!smartScan && original && value && (
        <div>
          <Button type="button" variant="secondary" onClick={() => setCropping(true)}>
            Crop again
          </Button>
        </div>
      )}
      {!smartScan && cropping && original && (
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
  showTypeChoice = true,
  showHint = true,
  smartScan = false,
  onAccepted,
  onDtiAccepted,
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
  showPrimary?: boolean;
  showDti?: boolean;
  showTypeChoice?: boolean;
  showHint?: boolean;
  smartScan?: boolean;
  onAccepted?: ((file: File) => void) | undefined;
  onDtiAccepted?: ((file: File) => void) | undefined;
  idType?: PhIdTypeCode;
  onIdTypeChange?: (type: PhIdTypeCode) => void;
}) {
  const isRegistration = step.type === 'company_registration';
  const idLabel = idType ? PH_ID_TYPES[idType].label : step.label;

  return (
    <div className="flex flex-col gap-2">
      {showHint && <p className="text-sm text-text-muted">{step.hint}</p>}
      {isRegistration && showPrimary && showTypeChoice && (
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
          smartScan={smartScan}
          onAccepted={onAccepted}
        />
      )}
      {isRegistration && showDti && (
        <CroppableCapture
          id="doc-dti_certificate"
          label="DTI Business Name certificate (secondary, optional)"
          value={dti}
          onChange={onDtiChange}
          smartScan={smartScan}
          onAccepted={onDtiAccepted}
        />
      )}
    </div>
  );
}

// A failed or unavailable scan is not an error: the form just opens empty.
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

// Null (OCR down) lets the user type it by hand; a read that found nothing, or the wrong paper, does not.
function registrationUnreadable(scan: Awaited<ReturnType<typeof scanForSuggestions>>): boolean {
  const s = scan?.suggestions;
  return scan !== null && (scan.layoutRecognized === false || !(s?.companyName || s?.tin || s?.secNumber));
}

// Typing hint only: every ID still gets staff review; the RFC-2 0.90 gate is separate.
const LEGIBLE_CONFIDENCE = 0.85;

interface IdScan {
  details: IdDetails;
  /** False when OCR was down: the user types the card by hand instead. */
  available: boolean;
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
    birthDate: s?.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(s.birthDate) ? s.birthDate : '',
    sex: s?.sex === 'M' || s?.sex === 'F' ? s.sex : '',
    address: s?.address ?? '',
  };
  return {
    details,
    available: scan !== null,
    read: Object.entries(details).some(([key, v]) => key !== 'idType' && Boolean(v)),
    unclear: scan?.confidence != null && scan.confidence < LEGIBLE_CONFIDENCE,
  };
}

function IdReviewStep({
  scan,
  value,
  onChange,
  onBack,
  onConfirm,
  footerActions = false,
  showStepHint = true,
}: {
  scan: IdScan;
  value: IdDetails;
  onChange: (value: IdDetails) => void;
  onBack: () => void;
  onConfirm: () => void;
  footerActions?: boolean;
  showStepHint?: boolean;
}) {
  const set = (patch: Partial<IdDetails>) => onChange({ ...value, ...patch });
  const card = PH_ID_TYPES[value.idType];
  return (
    <form
      id={footerActions ? 'company-id-review' : undefined}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm();
      }}
    >
      <p className="text-sm text-text-muted">
        {showStepHint ? 'Step 2 of 3. ' : ''}Check your {card.label} details. The rental team compares them with the card before verifying.
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
      {!footerActions && <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary">
          Next: company registration
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Retake ID
        </Button>
      </div>}
    </form>
  );
}

function useDocumentCapture() {
  const [governmentId, setGovernmentId] = useState<File | null>(null);
  const [idDetails, setIdDetails] = useState<IdDetails>(EMPTY_ID);
  const [idScan, setIdScan] = useState<IdScan | null>(null);
  const [registration, setRegistration] = useState<File | null>(null);
  const [registrationType, setRegistrationType] = useState<PrimaryRegistrationType>('bir_cor');
  const [dti, setDti] = useState<File | null>(null);
  const [scanning, setScanning] = useState(false);
  // A paper the scan could not read stops the wizard on its step until it is retaken.
  const [scanRejected, setScanRejected] = useState<string | null>(null);
  async function scanGovernmentId(file = governmentId): Promise<boolean> {
    if (!file) return false;
    setScanning(true);
    setScanRejected(null);
    const scan = await scanId(file, idDetails.idType);
    setScanning(false);
    if (scan.available && !scan.read) {
      setGovernmentId(null);
      setScanRejected(`We could not read this ${PH_ID_TYPES[idDetails.idType].label}. Take a clear photo of the whole card.`);
      return false;
    }
    setIdScan(scan);
    setIdDetails(scan.details);
    return true;
  }
  function rejectRegistration() {
    setRegistration(null);
    setScanRejected(`This doesn't look like a ${DOC_LABELS[registrationType]}. Upload a clear photo of the whole page.`);
  }
  return {
    governmentId, setGovernmentId, idDetails, setIdDetails, idScan, setIdScan, registration, setRegistration,
    registrationType, setRegistrationType, dti, setDti, scanning, setScanning, scanGovernmentId,
    scanRejected, setScanRejected, rejectRegistration,
  };
}

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
  const {
    governmentId, setGovernmentId, idDetails, setIdDetails, idScan, setIdScan, registration, setRegistration,
    registrationType, setRegistrationType, dti, setDti, scanning, setScanning, scanGovernmentId,
    scanRejected, setScanRejected, rejectRegistration,
  } = useDocumentCapture();
  const [selectedIdType, setSelectedIdType] = useState<PhIdTypeCode | ''>('');
  const [selectedRegistrationType, setSelectedRegistrationType] = useState<PrimaryRegistrationType | ''>('');
  const [idTypeConfirmed, setIdTypeConfirmed] = useState(false);
  const [registrationTypeConfirmed, setRegistrationTypeConfirmed] = useState(false);
  const [idConfirmed, setIdConfirmed] = useState(false);
  const [primaryScanned, setPrimaryScanned] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Step lives in the URL so Back/Forward move between steps; the page stays mounted so captures survive.
  const { step: urlStep } = accountCompanyNewRoute.useSearch();
  const setStage = (step: WizardStep) => void navigate({ to: '/account/companies/new', search: { step } });
  const submitted = useRef(false);
  const exiting = useRef(false);
  const dirty = Boolean(selectedIdType || selectedRegistrationType || governmentId || registration || dti || companyName || billingAddress || contactMobile || tin || secNumber || dtiNumber);
  useBlocker({
    shouldBlockFn: ({ current, next }) =>
      !submitted.current && !exiting.current &&
      dirty &&
      next.pathname !== current.pathname &&
      !window.confirm('Leave this application? Your progress and captured documents will be lost.'),
    enableBeforeUnload: () => dirty && !submitted.current,
  });
  // The ID is captured once per login: with one on file the ID steps are skipped and the server reuses it.
  const mineQuery = useQuery(companiesQueries.mine());
  const mine = mineQuery.data ?? [];
  const idOnFile = mine.some((c) => c.documents.some((d) => d.documentType === 'government_id'));
  // URL navigation cannot bypass a missing choice, capture, or scan after a reload.
  const requestedStage = urlStep ?? (idOnFile ? 'registration_type' : 'id_type');
  const requestedIndex = WIZARD_STEPS.indexOf(requestedStage);
  const stage: WizardStep = idOnFile && requestedIndex < WIZARD_STEPS.indexOf('registration_type')
    ? 'registration_type'
    : !idOnFile && requestedIndex > 0 && !idTypeConfirmed
      ? 'id_type'
    : !idOnFile && requestedIndex > 1 && !governmentId
        ? 'government_id'
        : !idOnFile && requestedIndex >= 2 && !idScan
          ? 'government_id'
        : !idOnFile && requestedIndex > 2 && !idConfirmed
          ? 'id_details'
          : requestedIndex > 3 && !registrationTypeConfirmed
            ? 'registration_type'
            : requestedIndex > 4 && !registration
              ? 'company_registration'
              : requestedIndex > 4 && !primaryScanned
                ? 'company_registration'
                : requestedStage;
  const [scanned, setScanned] = useState<boolean | null>(null);
  const [secFromScan, setSecFromScan] = useState(false);

  const showTin = registrationType === 'bir_cor';
  const showSec = registrationType === 'sec_certificate';
  const showDti = Boolean(dti);
  const existing = findSameCompany(
    { companyName, tin: showTin ? tin : null, secNumber: showSec ? secNumber : null },
    mine,
  );

  async function close() {
    if (busy) return;
    if (dirty && !window.confirm('Leave this application? Your progress and captured documents will be lost.')) return;
    exiting.current = true;
    try {
      await navigate({ to: '/account/applications', replace: true });
      document.getElementById('add-company-action')?.focus();
    } finally {
      exiting.current = false;
    }
  }

  async function checkId(file?: File) {
    if (await scanGovernmentId(file)) setStage('id_details');
  }

  function continueIdType() {
    if (!selectedIdType) return;
    if (selectedIdType !== idDetails.idType) {
      setGovernmentId(null);
      setIdScan(null);
      setIdConfirmed(false);
      setIdDetails({ ...EMPTY_ID, idType: selectedIdType });
    }
    setIdTypeConfirmed(true);
    setStage('government_id');
  }

  function continueRegistrationType() {
    if (!selectedRegistrationType) return;
    if (selectedRegistrationType !== registrationType) {
      setRegistration(null);
      setPrimaryScanned(false);
      setTin('');
      setSecNumber('');
      setCompanyName('');
      setBillingAddress('');
      setScanned(null);
      setSecFromScan(false);
    }
    setRegistrationType(selectedRegistrationType);
    setRegistrationTypeConfirmed(true);
    setStage('company_registration');
  }

  async function scanRegistration(file = registration) {
    if (!file) return;
    setScanning(true);
    const primary = await scanForSuggestions(file, registrationType);
    if (registrationUnreadable(primary)) {
      rejectRegistration();
      setScanning(false);
      return;
    }
    setScanRejected(null);
    const p = primary?.suggestions;
    if (p?.companyName) setCompanyName(p.companyName);
    if (p?.tin) setTin(p.tin);
    if (p?.secNumber) setSecNumber(p.secNumber);
    setSecFromScan(Boolean(p?.secNumber));
    if (p?.address && !billingAddress) setBillingAddress(p.address);
    setScanned(Boolean(p?.companyName || p?.tin || p?.secNumber));
    setPrimaryScanned(true);
    setScanning(false);
    setStage('dti_certificate');
  }

  async function finishDti(file = dti) {
    if (file) {
      setScanning(true);
      const secondary = await scanForSuggestions(file, 'dti_certificate');
      const d = secondary?.suggestions;
      if (d?.companyName && !companyName) setCompanyName(d.companyName);
      if (d?.dtiNumber) setDtiNumber(d.dtiNumber);
      if (d?.address && !billingAddress) setBillingAddress(d.address);
      if (d?.companyName || d?.dtiNumber) setScanned(true);
      setScanning(false);
    }
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
        registration,
        registrationType,
        dti,
        dtiNumber: showDti ? dtiNumber : '',
      });
      void queryClient.invalidateQueries({ queryKey: ['me', 'companies'] });
      toast.success('Company added', 'The rental team will verify it. You can request quotes now.');
      submitted.current = true;
      // replace: Back from the list must not reopen a finished application.
      await navigate({ to: '/account/applications', replace: true });
    } catch (err) {
      // The company exists even if an upload failed: send them to finish it, not create a duplicate.
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

  if (!mineQuery.isSuccess) {
    return (
      <>
        <ApplicationsPage />
        <Modal open onClose={close} size="xl" title="Add a company" description="Checking your company documents.">
          {mineQuery.isPending ? (
            <Skeleton label="Loading your company documents" rows={2} />
          ) : (
            <Alert type="error" header="Could not load your companies">
              Check your connection and <Button variant="secondary" onClick={() => void mineQuery.refetch()}>try again</Button>.
            </Alert>
          )}
        </Modal>
      </>
    );
  }

  const reviewingId = stage === 'id_details' && Boolean(idScan);
  const documentStage = stage === 'government_id' || stage === 'company_registration';
  const step = documentStage ? DOC_STEPS.find((item) => item.type === stage)! : null;
  const file = stage === 'government_id' ? governmentId : registration;
  const setFile = stage === 'government_id' ? setGovernmentId : setRegistration;
  const prompts: Record<WizardStep, string> = {
    id_type: 'Which government ID will you use?',
    government_id: `Photograph your ${PH_ID_TYPES[idDetails.idType].label}.`,
    id_details: 'Check the details on your ID.',
    registration_type: 'Which company registration do you have?',
    company_registration: `Photograph your ${DOC_LABELS[registrationType]}.`,
    dti_certificate: 'Do you also have a DTI business name certificate?',
    details: 'Review your company details.',
  };
  const activeSteps = idOnFile ? WIZARD_STEPS.slice(3) : WIZARD_STEPS;
  const stepNumber = activeSteps.indexOf(stage) + 1;
  const progress = `Step ${stepNumber} of ${activeSteps.length}`;
  const previous: Partial<Record<WizardStep, WizardStep>> = {
    government_id: 'id_type',
    id_details: 'government_id',
    ...(idOnFile ? {} : { registration_type: 'id_details' as const }),
    company_registration: 'registration_type',
    dti_certificate: 'company_registration',
    details: 'dti_certificate',
  };

  return (
    <>
      <ApplicationsPage />
      <Modal
        open
        onClose={close}
        closeDisabled={busy}
        size="xl"
        title="Add a company"
        description={prompts[stage]}
        footer={
          <>
            <span className="mr-auto text-sm text-text-muted">{progress}</span>
            <Button variant="ghost" disabled={busy || scanning} onClick={previous[stage] ? () => setStage(previous[stage]!) : close}>
              {previous[stage] ? 'Back' : 'Cancel'}
            </Button>
            {stage === 'id_type' && (
              <Button variant="primary" disabled={!selectedIdType} onClick={continueIdType}>Continue</Button>
            )}
            {stage === 'government_id' && (
              <Button
                variant="primary"
                disabled={!governmentId || scanning}
                loading={scanning}
                onClick={() => void checkId()}
              >
                Next: check your ID details
              </Button>
            )}
            {reviewingId && (
              <Button type="submit" form="company-id-review" variant="primary">Next: registration type</Button>
            )}
            {stage === 'registration_type' && (
              <Button variant="primary" disabled={!selectedRegistrationType} onClick={continueRegistrationType}>Continue</Button>
            )}
            {stage === 'company_registration' && (
              <Button variant="primary" disabled={!registration || scanning} loading={scanning} onClick={() => void scanRegistration()}>
                Next: optional DTI certificate
              </Button>
            )}
            {stage === 'dti_certificate' && (
              <>
                {!dti && <Button variant="primary" onClick={() => setStage('details')}>Skip for now</Button>}
                {dti && <Button variant="primary" loading={scanning} onClick={() => void finishDti()}>Next: review details</Button>}
              </>
            )}
            {stage === 'details' && (
              <Button type="submit" form="company-details" variant="primary" loading={busy} disabled={!accepted || Boolean(existing)}>
                Submit
              </Button>
            )}
          </>
        }
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <div role="progressbar" aria-label="Company setup progress" aria-valuenow={stepNumber} aria-valuemin={1} aria-valuemax={activeSteps.length} className="h-1 overflow-hidden rounded-pill bg-surface-sunk">
          <div className="h-full bg-accent transition-[width] duration-[180ms]" style={{ width: `${stepNumber / activeSteps.length * 100}%` }} />
        </div>
        {stage === 'id_type' && (
          <div className="flex max-w-xl flex-col gap-4 py-4">
          <p className="text-sm text-text-muted">Choose a valid ID with a clear photo and the whole card or page visible.</p>
          <Select label="ID type" value={selectedIdType} onChange={(event) => {
            const chosen = event.target.value as PhIdTypeCode;
            if (chosen !== selectedIdType) setIdTypeConfirmed(false);
            setSelectedIdType(chosen);
          }}>
            <option value="" disabled>Choose an ID type</option>
            {PH_ID_TYPE_CODES.map((code) => <option key={code} value={code}>{PH_ID_TYPES[code].label}</option>)}
          </Select>
          </div>
        )}
        {reviewingId && idScan && (
          <IdReviewStep
            scan={idScan}
            value={idDetails}
            onChange={setIdDetails}
            onBack={() => setStage('government_id')}
            onConfirm={() => { setIdConfirmed(true); setStage('registration_type'); }}
            footerActions
            showStepHint={false}
          />
        )}
        {stage === 'registration_type' && (
          <div className="flex max-w-xl flex-col gap-4 py-4">
          <p className="text-sm text-text-muted">Use the company document you can photograph clearly. DTI is offered separately after this.</p>
          <Select label="Registration type" value={selectedRegistrationType} onChange={(event) => {
            const chosen = event.target.value as PrimaryRegistrationType;
            if (chosen !== selectedRegistrationType) setRegistrationTypeConfirmed(false);
            setSelectedRegistrationType(chosen);
          }}>
            <option value="" disabled>Choose a registration document</option>
            {REGISTRATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          </div>
        )}
        {documentStage && step && (
          <div className="flex flex-col gap-4">
            <DocumentStep
              step={step}
              value={file}
              onChange={(picked) => {
                setFile(picked);
                if (stage === 'government_id') {
                  setIdScan(null);
                  setIdConfirmed(false);
                  setScanRejected(null);
                } else {
                  setPrimaryScanned(false);
                  setScanRejected(null);
                  if (registration) {
                    setTin('');
                    setSecNumber('');
                    setCompanyName('');
                    setBillingAddress('');
                    setScanned(null);
                    setSecFromScan(false);
                  }
                }
              }}
              registrationType={registrationType}
              onRegistrationTypeChange={setRegistrationType}
              dti={dti}
              onDtiChange={setDti}
              idType={idDetails.idType}
              showDti={false}
              showTypeChoice={false}
              showHint={false}
              smartScan
              onAccepted={stage === 'government_id' ? (accepted) => void checkId(accepted) : (accepted) => void scanRegistration(accepted)}
            />
            {scanRejected && <Alert type="error" header="Document not accepted">{scanRejected}</Alert>}
            <p className="text-xs text-text-muted">Both documents are needed before the rental team can verify this company.</p>
          </div>
        )}
        {stage === 'dti_certificate' && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-muted">This is optional. You can continue without it.</p>
            <CroppableCapture id="doc-dti_certificate" label="DTI Business Name certificate" value={dti} onChange={(file) => { setDti(file); setDtiNumber(''); }} smartScan onAccepted={(accepted) => void finishDti(accepted)} />
          </div>
        )}
        {stage === 'details' && <form id="company-details" onSubmit={submit} className="flex flex-col gap-4">
          {scanned !== null && (
            <p role="status" className="text-sm text-text-muted">
              {scanned
                ? 'Filled in from your registration documents. Check every field before you submit.'
                : 'We could not read your registration documents, so please fill this in yourself.'}
            </p>
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
              hint={
                secFromScan
                  ? 'Read from your SEC certificate. Retake the photo to change it.'
                  : 'From your SEC certificate (Company Reg. No.).'
              }
              readOnly={secFromScan}
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
          <div className="rounded-md border border-border px-3 py-2 text-sm text-text-muted">
            <span>
              Scanned: {idOnFile ? 'ID on file' : governmentId ? PH_ID_TYPES[idDetails.idType].label : 'no ID'}, {DOC_LABELS[registrationType]}
              {dti ? ' and DTI certificate' : ''}.
            </span>
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
          <p className="text-xs text-text-muted">
            You can upload the documents later, but payment opens only once the company is verified.
          </p>
        </form>}
        </div>
      </Modal>
    </>
  );
}

function CompanyDocumentsPage() {
  const { companyId } = accountCompanyDocumentsRoute.useParams();
  const company = useQuery(companiesQueries.mine()).data?.find((row) => row.id === companyId);
  // A document on file is replaced only after a rejection; a missing one can always be added.
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
  const {
    governmentId, setGovernmentId, idDetails, setIdDetails, idScan, registration, setRegistration,
    registrationType, setRegistrationType, dti, setDti, scanning, setScanning, scanGovernmentId,
    scanRejected, rejectRegistration,
  } = useDocumentCapture();
  const [busy, setBusy] = useState(false);
  const [registrationChecked, setRegistrationChecked] = useState(false);
  const [chosenStage, setStage] = useState<DocStep | 'id_details'>('government_id');
  const stage = !idOpen && chosenStage !== 'company_registration' ? 'company_registration' : chosenStage;
  // A double-tap on "Next" would land on "Upload" in the same spot; ignore submits within advanceGraceMs of the flip.
  const stageChangedAt = useRef(0);
  const advanceGraceMs = 400;

  const step = DOC_STEPS.find((s) => s.type === stage);
  const file = stage === 'government_id' ? governmentId : registration;
  const setFile = stage === 'government_id' ? setGovernmentId : setRegistration;

  async function checkId(file?: File) {
    if (await scanGovernmentId(file)) setStage('id_details');
  }

  function advanceToRegistration() {
    stageChangedAt.current = Date.now();
    setStage('company_registration');
  }

  async function checkRegistration(file: File) {
    setScanning(true);
    const unreadable = registrationUnreadable(await scanForSuggestions(file, registrationType));
    setScanning(false);
    if (unreadable) { setRegistrationChecked(false); rejectRegistration(); return; }
    setRegistrationChecked(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Both steps share this form: a stray submit before the registration step must not upload a partial set.
    if (stage !== 'company_registration') return;
    if (Date.now() - stageChangedAt.current < advanceGraceMs) return;
    // Same bytes as the upload: the server's OCR cache makes the upload reuse this read.
    if (registration && !registrationChecked) {
      setScanning(true);
      const unreadable = registrationUnreadable(await scanForSuggestions(registration, registrationType));
      setScanning(false);
      if (unreadable) return rejectRegistration();
    }
    setBusy(true);
    try {
      await uploadDocuments(companyId, {
        governmentId,
        idDetails,
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
                onChange={(picked) => { setFile(picked); if (stage === 'company_registration') setRegistrationChecked(false); }}
                registrationType={registrationType}
                onRegistrationTypeChange={(type) => { setRegistrationType(type); setRegistrationChecked(false); }}
                dti={dti}
                onDtiChange={setDti}
                idType={idDetails.idType}
                onIdTypeChange={(idType) => setIdDetails({ ...idDetails, idType })}
                showPrimary={primaryOpen}
                showDti={dtiOpen}
                smartScan
                onAccepted={stage === 'government_id' ? (accepted) => void checkId(accepted) : (accepted) => void checkRegistration(accepted)}
                onDtiAccepted={(accepted) => { void scanForSuggestions(accepted, 'dti_certificate'); }}
              />
            )}
            {scanRejected && (
              <Alert type="error" header="Document not accepted">
                {scanRejected}
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              {stage === 'government_id' ? (
                <Button
                  type="button"
                  variant="primary"
                  disabled={!governmentId || scanning}
                  loading={scanning}
                  onClick={() => void checkId()}
                >
                  Next: check your ID details
                </Button>
              ) : (
                <>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={busy || scanning}
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

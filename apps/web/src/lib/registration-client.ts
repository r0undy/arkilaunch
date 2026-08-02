// No POST /tenants/register endpoint exists yet (only login/refresh/2fa are
// live). Shaped like the eventual real request so wiring it up later is a
// one-line change; state is held in sessionStorage across the two-step form,
// mirroring the token-storage pattern in auth-client.ts.
export interface PersonalDetails {
  firstName: string;
  lastName: string;
  mobileNumber: string;
  email: string;
  jobTitle: string;
  password: string;
}

export interface CompanyDetails {
  companyName: string;
  businessAddress: string;
  secNumber: string;
  tin: string;
}

const DRAFT_KEY = 'arkilaunch.registrationDraft';

export function savePersonalDetails(details: PersonalDetails): void {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ personal: details }));
}

export function getPersonalDetails(): PersonalDetails | null {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw).personal ?? null;
  } catch {
    return null;
  }
}

export async function submitRegistration(_company: CompanyDetails): Promise<{ submitted: true }> {
  return { submitted: true };
}

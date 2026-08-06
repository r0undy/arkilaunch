import type { TenantRegisterRequest, TenantRegisterResponse } from '@arkilaunch/shared';
import { apiPost } from './api-client.js';

// Two-step form state held in sessionStorage across /register ->
// /register/company, mirroring the token-storage pattern in
// auth-client.ts. No `password` field: the owner sets their own password
// later through POST /auth/activate once an admin approves the
// application (see the backend-unblock-frontend Change Record) -- there is
// no platform-console approval UI yet, so approval is an admin/API step.
export interface PersonalDetails {
  firstName: string;
  lastName: string;
  mobileNumber: string;
  email: string;
  jobTitle: string;
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

export async function submitRegistration(company: CompanyDetails): Promise<TenantRegisterResponse> {
  const personal = getPersonalDetails();
  if (!personal) throw new Error('missing_personal_details');

  const request: TenantRegisterRequest = { ...personal, ...company };
  const response = await apiPost<TenantRegisterResponse>('/tenants/register', request);
  sessionStorage.removeItem(DRAFT_KEY);
  return response;
}

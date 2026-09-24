import type { CompanyResponse } from '@arkilaunch/shared';
import type { CartItem } from './cart-client.js';

// What the cart refuses to submit, and why, in one place a test can drive.
//
// The cart used to express all of this as one `disabled` prop on the submit
// button: a customer could see the button dead without being told which field
// was at fault, and the date inputs were never checked at all -- a stale cart
// (dates sat in sessionStorage past their start) went to the API and came back
// a 400.

export interface CartFieldErrors {
  companyId?: string;
  projectSiteId?: string;
  siteContact?: string;
  siteNotes?: string;
  // Keyed by cart index.
  items: Record<number, string>;
}

export const MAX_RENTAL_DAYS = 365;
export const MAX_SITE_CONTACT = 200;
export const MAX_SITE_NOTES = 1000;

export function hasErrors(errors: CartFieldErrors): boolean {
  return Boolean(
    errors.companyId ||
      errors.projectSiteId ||
      errors.siteContact ||
      errors.siteNotes ||
      Object.keys(errors.items).length > 0,
  );
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * A company can only be booked against once staff have verified it.
 *
 * This is stricter than the API, which accepts a booking from an unverified
 * company and gates only payment (409 `company_not_verified`). Recorded as
 * superseding that decision in cr-arkilaunch-cart-validation.md: a quote
 * negotiated against a company that never passes KYC wastes the rental team's
 * pricing work and the customer's time, so the block moves earlier.
 */
export function isSelectableCompany(company: CompanyResponse): boolean {
  return company.kycStatus === 'approved';
}

export function companyStatusLabel(company: CompanyResponse): string {
  if (company.kycStatus === 'approved') return '';
  return company.kycStatus === 'rejected' ? 'verification declined' : 'awaiting verification';
}

export interface ValidateCartInput {
  items: CartItem[];
  companies: CompanyResponse[];
  companyId: string;
  projectSiteId: string;
  siteContact: string;
  siteNotes: string;
}

export function validateCart(input: ValidateCartInput): CartFieldErrors {
  const errors: CartFieldErrors = { items: {} };
  const company = input.companies.find((c) => c.id === input.companyId);

  if (!input.companyId) {
    errors.companyId = 'Choose which company this rental is for.';
  } else if (!company) {
    errors.companyId = 'That company is no longer on your account.';
  } else if (!isSelectableCompany(company)) {
    errors.companyId =
      company.kycStatus === 'rejected'
        ? `${company.companyName} failed verification, so it cannot rent. Contact the rental team.`
        : `${company.companyName} is still awaiting verification. You can book once the rental team approves it.`;
  }

  if (!input.projectSiteId) {
    errors.projectSiteId = 'Choose where the machines are going.';
  }

  if (input.siteContact.trim() && input.siteContact.trim().length < 3) {
    errors.siteContact = 'Give a name the driver can ask for, and a number.';
  }
  if (input.siteContact.length > MAX_SITE_CONTACT) {
    errors.siteContact = `Keep this under ${MAX_SITE_CONTACT} characters.`;
  }
  if (input.siteNotes.length > MAX_SITE_NOTES) {
    errors.siteNotes = `Keep this under ${MAX_SITE_NOTES} characters.`;
  }

  const today = startOfToday();
  input.items.forEach((item, index) => {
    const start = new Date(item.start).getTime();
    const end = new Date(item.end).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) {
      errors.items[index] = 'Set a rental start and end.';
      return;
    }
    // A cart persists in sessionStorage. Dates that were fine when the machine
    // went in can be in the past by the time it is submitted.
    if (start < today) {
      errors.items[index] = 'That start date has passed. Pick a new one.';
      return;
    }
    if (end <= start) {
      errors.items[index] = 'The return date has to be after the start date.';
      return;
    }
    if ((end - start) / 86_400_000 > MAX_RENTAL_DAYS) {
      errors.items[index] = `A single booking runs at most ${MAX_RENTAL_DAYS} days.`;
    }
  });

  return errors;
}

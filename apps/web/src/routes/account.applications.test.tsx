import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

// A miscount here tells a customer a company is approved when it is not.

const COMPANIES = [
  { id: 'c1', companyName: '123 Company', tin: null, secNumber: 'PH62780901', billingAddress: null, kycStatus: 'pending', firstName: null, middleName: null, lastName: null, documents: [], createdAt: '2026-09-01T00:00:00.000Z' },
  { id: 'c2', companyName: 'Acorn Company', tin: null, secNumber: 'PH81923101', billingAddress: null, kycStatus: 'pending', firstName: null, middleName: null, lastName: null, documents: [], createdAt: '2026-09-02T00:00:00.000Z' },
  { id: 'c4', companyName: 'Response Basics Incorporated', tin: '444-075-342-000', secNumber: null, billingAddress: null, kycStatus: 'pending', firstName: null, middleName: null, lastName: null, rejection: null, documents: [
    { id: 'd1', documentType: 'government_id', status: 'needs_review', createdAt: '2026-09-04T00:00:00.000Z' },
    { id: 'd2', documentType: 'selfie_with_id', status: 'needs_review', createdAt: '2026-09-04T00:00:00.000Z' },
    { id: 'd3', documentType: 'bir_cor', status: 'needs_review', createdAt: '2026-09-04T00:00:00.000Z' },
  ], createdAt: '2026-09-04T00:00:00.000Z' },
  { id: 'c3', companyName: 'Manila Constructions', tin: null, secNumber: 'PH01982234', billingAddress: null, kycStatus: 'approved', firstName: null, middleName: null, lastName: null, documents: [], createdAt: '2026-09-03T00:00:00.000Z' },
];

async function renderApplications(path = '/account/applications', companies = COMPANIES) {
  setAccessToken(makeToken(makeValidClaims({ role: 'customer' })));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes('/me/companies')
          ? new Response(JSON.stringify(companies), { status: 200 })
          : new Response('[]', { status: 200 }),
      ),
    ),
  );
  const rendered = await renderRoute(path);
  if (companies.length > 0) {
    await waitFor(() => expect(screen.getByRole('group', { name: '123 Company' })).toBeInTheDocument());
  } else {
    await waitFor(() => expect(screen.getByText('Add your company first')).toBeInTheDocument());
  }
  return rendered;
}

// Company cards are named groups; the status filter is a group too, so it is left out.
const cards = () =>
  screen
    .queryAllByRole('group')
    .map((el) => el.getAttribute('aria-label'))
    .filter((name) => name !== 'Show applications');

describe('Company Applications', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('counts the companies by verification state', async () => {
    const { unmount } = await renderApplications();
    const tile = (label: string) => screen.getByText(label, { selector: 'dt' }).closest('div')!;
    expect(within(tile('Total applications')).getByText('4')).toBeInTheDocument();
    expect(within(tile('Approved')).getByText('1')).toBeInTheDocument();
    expect(within(tile('Pending approval')).getByText('3')).toBeInTheDocument();
    for (const label of ['Total applications', 'Approved', 'Pending approval']) {
      expect(tile(label).firstElementChild?.tagName).toBe('DT');
    }
    unmount();
  });

  it('opens add company over Applications and returns there on close', async () => {
    const { unmount } = await renderApplications('/account/applications', []);
    await userEvent.click(document.getElementById('add-company-action')!);
    expect(screen.getByRole('heading', { name: 'Applications' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Sidebar' })).not.toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: 'Add a company' });
    expect(within(dialog).getByText('Step 1 of 7')).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'ID type' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a company' })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Applications' })).toBeInTheDocument();
    unmount();
  });

  it('warns before discarding wizard progress', async () => {
    const { unmount } = await renderApplications('/account/companies/new', []);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const dialog = screen.getByRole('dialog', { name: 'Add a company' });
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'ID type' }));
    await userEvent.click(screen.getByRole('option', { name: /Philippine National ID/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Add a company' })).toBeInTheDocument();
    confirm.mockReturnValue(true);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add a company' })).not.toBeInTheDocument());
    unmount();
  });

  it('advances the ID review from the modal footer', async () => {
    const { unmount } = await renderApplications('/account/companies/new', []);
    const dialog = screen.getByRole('dialog', { name: 'Add a company' });
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'ID type' }));
    await userEvent.click(screen.getByRole('option', { name: /Philippine National ID/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.upload(within(dialog).getByTestId('doc-government_id-file'), new File(['%PDF'], 'id.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: /First name/ })).toBeInTheDocument());
    await userEvent.type(within(dialog).getByRole('textbox', { name: /First name/ }), 'Juan');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /Last name/ }), 'Dela Cruz');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /PCN/ }), '1234-5678-9012-3456');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next: registration type' }));
    await waitFor(() => expect(within(dialog).getByText('Step 4 of 7')).toBeInTheDocument());
    expect(within(dialog).getByRole('combobox', { name: 'Registration type' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Registration type' }));
    await userEvent.click(screen.getByRole('option', { name: 'SEC Certificate of Incorporation' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.upload(within(dialog).getByTestId('doc-company_registration-file'), new File(['%PDF'], 'sec.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(within(dialog).getByText('Step 6 of 7')).toBeInTheDocument());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Skip for now' }));
    expect(within(dialog).getByText('Step 7 of 7')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: /Company name/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('textbox', { name: 'TIN' })).not.toBeInTheDocument();
    unmount();
  }, 15_000);

  it('skips saved ID steps and protects direct links to unfinished steps', async () => {
    const { unmount } = await renderApplications('/account/companies/new?step=details');
    const dialog = screen.getByRole('dialog', { name: 'Add a company' });
    expect(within(dialog).getByText('Step 1 of 4')).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Registration type' })).toBeInTheDocument();
    unmount();
  });

  it('offers DTI separately and clears a captured registration when its type changes', async () => {
    const { unmount } = await renderApplications('/account/companies/new');
    const dialog = screen.getByRole('dialog', { name: 'Add a company' });
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Registration type' }));
    await userEvent.click(screen.getByRole('option', { name: 'BIR Certificate of Registration (Form 2303)' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.upload(within(dialog).getByTestId('doc-company_registration-file'), new File(['%PDF'], 'bir.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(within(dialog).getByTestId('doc-dti_certificate-file')).toBeInTheDocument());
    await userEvent.upload(within(dialog).getByTestId('doc-dti_certificate-file'), new File(['%PDF'], 'dti.pdf', { type: 'application/pdf' }));
    expect(within(dialog).getByRole('textbox', { name: /DTI business name number/ })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Registration type' }));
    await userEvent.click(screen.getByRole('option', { name: 'SEC Certificate of Incorporation' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByRole('button', { name: 'Next: optional DTI certificate' })).toBeDisabled();
    unmount();
  }, 15_000);

  it('clears an ID capture after the chosen ID type changes', async () => {
    const { unmount } = await renderApplications('/account/companies/new', []);
    const dialog = screen.getByRole('dialog', { name: 'Add a company' });
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'ID type' }));
    await userEvent.click(screen.getByRole('option', { name: /Philippine National ID/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.upload(within(dialog).getByTestId('doc-government_id-file'), new File(['%PDF'], 'id.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(within(dialog).getByText('Check the details on your ID.')).toBeInTheDocument());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'ID type' }));
    await userEvent.click(screen.getByRole('option', { name: 'Philippine passport' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    expect(within(dialog).getByRole('button', { name: 'Next: check your ID details' })).toBeDisabled();
    expect(within(dialog).getByText('Photograph your Philippine passport.')).toBeInTheDocument();
    unmount();
  });

  it('keeps the ID choice across browser Back and Forward', async () => {
    const { router, unmount } = await renderApplications('/account/companies/new', []);
    const dialog = screen.getByRole('dialog', { name: 'Add a company' });
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'ID type' }));
    await userEvent.click(screen.getByRole('option', { name: 'Philippine passport' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(within(dialog).getByText('Step 2 of 7')).toBeInTheDocument());
    router.history.back();
    await waitFor(() => expect(within(dialog).getByText('Step 1 of 7')).toBeInTheDocument());
    router.history.forward();
    await waitFor(() => expect(within(dialog).getByText('Step 2 of 7')).toBeInTheDocument());
    expect(within(dialog).getByText('Photograph your Philippine passport.')).toBeInTheDocument();
    unmount();
  });

  it('narrows to one status at a time', async () => {
    const { unmount } = await renderApplications();
    expect(cards()).toHaveLength(4);

    await userEvent.click(screen.getByRole('button', { name: 'Pending approval' }));
    expect(cards()).toEqual(['123 Company', 'Acorn Company', 'Response Basics Incorporated']);

    await userEvent.click(screen.getByRole('button', { name: 'Approved' }));
    expect(cards()).toEqual(['Manila Constructions']);

    await userEvent.click(screen.getByRole('button', { name: 'All applications' }));
    expect(cards()).toHaveLength(4);
    unmount();
  });

  it('searches the registration number as well as the name', async () => {
    const { unmount } = await renderApplications();
    const box = screen.getByRole('searchbox', { name: /search companies/i });

    await userEvent.type(box, 'acorn');
    expect(cards()).toEqual(['Acorn Company']);

    await userEvent.clear(box);
    await userEvent.type(box, 'PH01982234');
    expect(cards()).toEqual(['Manila Constructions']);
    unmount();
  });

  it('shows the number and documents actually submitted, and where it stands', async () => {
    const { unmount } = await renderApplications();
    const card = screen.getByRole('group', { name: 'Response Basics Incorporated' });
    expect(within(card).getByText('444-075-342-000')).toBeInTheDocument();
    expect(within(card).getByText(/Submitted: .*Form 2303/)).toBeInTheDocument();
    expect(within(card).getByText(/Under review/)).toBeInTheDocument();
    expect(within(card).queryByText(/Not provided/)).toBeNull();
    const incomplete = screen.getByRole('group', { name: '123 Company' });
    expect(within(incomplete).getByText(/Still needed/)).toBeInTheDocument();
    unmount();
  });

  it('distinguishes "nothing matches" from "nothing registered"', async () => {
    const { unmount } = await renderApplications();
    await userEvent.type(screen.getByRole('searchbox', { name: /search companies/i }), 'zzz');
    expect(cards()).toHaveLength(0);
    expect(screen.getByText(/No companies match/i)).toBeInTheDocument();
    unmount();
  });
});

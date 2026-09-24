import { describe, expect, it, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupSteps } from './account.index.js';
import { DOC_STEPS } from './account.companies.js';
import { signupError } from './signup.js';
import { renderRoute } from '../test/render-route.js';
import { makeToken, makeValidClaims } from '../test/make-token.js';
import { setAccessToken } from '../lib/auth-client.js';

// The checklist is what tells a new customer why they cannot pay yet; a
// step marked done without its record behind it would send them to a
// checkout that refuses them.
describe('setupSteps', () => {
  const done = (...args: Parameters<typeof setupSteps>) =>
    setupSteps(...args)
      .filter((s) => s.done)
      .map((s) => s.label);

  it('starts with nothing done', () => {
    expect(done([], 0)).toEqual([]);
  });

  it('needs both documents before the documents step is done', () => {
    const oneDoc = [{ kycStatus: 'pending', documents: [{ documentType: 'government_id' }] }];
    expect(done(oneDoc, 1)).toEqual(['Add your company', 'Add a project site']);
    const both = [
      {
        kycStatus: 'approved',
        documents: [{ documentType: 'government_id' }, { documentType: 'company_registration' }],
      },
    ];
    expect(done(both, 1)).toHaveLength(4);
  });
});

// Regression for the "government ID upload gets stuck" bug. Root cause: step
// 1's "Next" button and step 2's "Upload" button sit in the same spot in the
// shared <form>. A stray submit while still on step 1, or a second tap that
// lands on "Upload" the instant it replaces "Next" (a fast double-tap, or
// any input lag), uploaded a partial document set and navigated the customer
// away before they ever reached the registration step -- leaving an
// orphaned government_id document behind each time.
describe('CompanyDocumentsPage: guards against a premature submit', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function setupOnStep1() {
    const accessToken = makeToken(makeValidClaims({ role: 'customer' }));
    setAccessToken(accessToken);

    // jsdom has no image decoder or canvas raster -- CaptureField's
    // prepareUpload() needs both to resolve, exactly as image-compression.test.ts stubs them.
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() }) as unknown as ImageBitmap),
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: () => {},
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
      cb!(new Blob([new Uint8Array(64)], { type: 'image/jpeg' }));
    });
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/documents')) {
        return Promise.resolve(new Response(JSON.stringify({}), { status: 201 }));
      }
      // The ID scan: extraction off, so the customer types the details.
      if (String(url).includes('/kyc/scan')) {
        return Promise.resolve(
          new Response(JSON.stringify({ suggestions: {}, confidence: null, extractionAvailable: false }), {
            status: 200,
          }),
        );
      }
      return Promise.resolve(new Response('[]', { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const rendered = await renderRoute('/account/companies/company-1/documents');
    await waitFor(() => expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument());

    const file = new File(['x'], 'id.png', { type: 'image/png' });
    const fileInput = document.querySelector('#doc-government_id-file') as HTMLInputElement;
    await userEvent.upload(fileInput, file);
    // An image ID opens the cropper; skipping keeps the photo as taken.
    await userEvent.click(await screen.findByRole('button', { name: /skip cropping/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /next: check your id details/i })).not.toBeDisabled(),
    );

    return { ...rendered, fileInput, fetchMock };
  }

  it('a stray submit while still on step 1 does not upload or navigate away', async () => {
    const { router, unmount, fileInput, fetchMock } = await setupOnStep1();

    // Simulate the race directly: a submit event reaches the shared <form>
    // while stage is still 'government_id', bypassing whatever triggered it
    // in the browser.
    const form = fileInput.closest('form')!;
    form.requestSubmit();

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/documents'))).toBe(false);
    });
    expect(screen.getByText(/Step 1 of 3/i)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/account/companies/company-1/documents');
    unmount();
  });

  it('a second tap landing on "Upload" right as it replaces "Next" does not upload the government ID alone', async () => {
    const { unmount, fetchMock } = await setupOnStep1();

    await userEvent.click(screen.getByRole('button', { name: /next: check your id details/i }));
    await waitFor(() => expect(screen.getByText(/Step 2 of 3/i)).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText(/first name/i), 'Juan');
    await userEvent.type(screen.getByLabelText(/last name/i), 'Dela Cruz');
    await userEvent.type(screen.getByLabelText(/PCN/i), '1234-5678-9012-3456');
    await userEvent.click(screen.getByRole('button', { name: /next: company registration/i }));
    await waitFor(() => expect(screen.getByText(/Step 3 of 3/i)).toBeInTheDocument());

    // The double-tap: "Upload" now occupies the exact spot "Next" was just
    // tapped from. A tap landing there in the same beat as the transition
    // must not go through with only the government ID set.
    const form = document.querySelector('#doc-company_registration-file')!.closest('form')!;
    form.requestSubmit();

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/documents'))).toBe(false);
    unmount();
  });
});

describe('signupError', () => {
  it('points an existing email at login', () => {
    expect(signupError('email_taken')).toMatch(/Log in/);
  });
});

// The two documents are captured one at a time, and the ID is the gate: a
// customer should never be asked to frame both papers at once, and the
// registration scan is what prefills the form behind it.
describe('DOC_STEPS', () => {
  it('asks for the government ID before the company registration', () => {
    expect(DOC_STEPS.map((step) => step.type)).toEqual(['government_id', 'company_registration']);
  });

  it('numbers the steps for the customer', () => {
    expect(DOC_STEPS[0]?.hint).toMatch(/Step 1 of 3/);
    // Step 2 is checking what the ID says (IdReviewStep).
    expect(DOC_STEPS[1]?.hint).toMatch(/Step 3 of 3/);
  });
});

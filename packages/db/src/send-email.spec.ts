import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendEmail } from './send-email.js';

describe('sendEmail without RESEND_API_KEY', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function logged(): Promise<string> {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await sendEmail('owner@example.test', 'Activate your account', 'https://app.test/activate?token=secret');
    return String(warn.mock.calls[0]?.[0]);
  }

  it('logs only the recipient and subject inside a deployed container', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('CONTAINER_APP_NAME', 'arkilaunch-api');
    const line = await logged();
    expect(line).toContain('owner@example.test');
    expect(line).toContain('Activate your account');
    expect(line).not.toContain('token=secret');
  });

  it('prints the body for local dev', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('CONTAINER_APP_NAME', '');
    vi.stubEnv('CONTAINER_APP_JOB_NAME', '');
    expect(await logged()).toContain('token=secret');
  });
});

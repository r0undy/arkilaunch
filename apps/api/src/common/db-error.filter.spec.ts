import { describe, expect, it, vi, afterEach } from 'vitest';
import { Logger, NotFoundException, type ArgumentsHost } from '@nestjs/common';
import { DbErrorFilter } from './db-error.filter.js';

function run(exception: unknown) {
  const json = vi.fn();
  const status = vi.fn((_code: number) => ({ json }));
  const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as unknown as ArgumentsHost;
  new DbErrorFilter().catch(exception, host);
  return { status: status.mock.calls[0]?.[0], body: json.mock.calls[0]?.[0] };
}

describe('DbErrorFilter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs an unmapped error and answers a bare 500', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(run(new Error('boom'))).toEqual({ status: 500, body: { error: 'internal_error' } });
    expect(logged).toHaveBeenCalledOnce();
  });

  it('logs only the code of a database error', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    run(Object.assign(new Error('Failed query: params: a@b.test'), { cause: { code: '23505' } }));
    expect(logged).toHaveBeenCalledWith('database error 23505');
  });

  it('does not log an HttpException or a malformed input', () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    expect(run(new NotFoundException({ error: 'x' })).status).toBe(404);
    expect(run({ code: '22P02' })).toEqual({ status: 400, body: { error: 'invalid_input_syntax' } });
    expect(logged).not.toHaveBeenCalled();
  });
});

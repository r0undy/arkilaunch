import {
  BadRequestException,
  Catch,
  HttpException,
  InternalServerErrorException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

// There was no exception filter of any kind registered, so anything that
// was not already an HttpException reached the client as a raw 500 with
// the driver's own message (audit-api-surface.md #6). Two problems: a
// malformed id read as a server fault rather than a bad request, and
// Postgres internals were echoed to an unauthenticated caller.
//
// 22P02 is `invalid_text_representation` -- a malformed uuid/number/enum
// reaching a query. That is a client error, so it answers 400. Everything
// else stays a 500 but says nothing about the database.
const INVALID_TEXT_REPRESENTATION = '22P02';

function pgCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

@Catch()
export class DbErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    const mapped =
      exception instanceof HttpException
        ? exception
        : pgCode(exception) === INVALID_TEXT_REPRESENTATION
          ? new BadRequestException({ error: 'invalid_input_syntax' })
          : new InternalServerErrorException({ error: 'internal_error' });

    response.status(mapped.getStatus()).json(mapped.getResponse());
  }
}

import {
  BadRequestException,
  Catch,
  HttpException,
  InternalServerErrorException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { pgError } from '@arkilaunch/db';

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

const pgCode = (error: unknown) => pgError(error).code;
const logger = new Logger('ExceptionsHandler');

@Catch()
export class DbErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    const code = pgCode(exception);
    const mapped =
      exception instanceof HttpException
        ? exception
        : code === INVALID_TEXT_REPRESENTATION
          ? new BadRequestException({ error: 'invalid_input_syntax' })
          : new InternalServerErrorException({ error: 'internal_error' });
    if (!(exception instanceof HttpException) && code !== INVALID_TEXT_REPRESENTATION) {
      // A database error's message echoes query parameters (emails, names), so only its code is logged.
      logger.error(code ? `database error ${code}` : exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(mapped.getStatus()).json(mapped.getResponse());
  }
}

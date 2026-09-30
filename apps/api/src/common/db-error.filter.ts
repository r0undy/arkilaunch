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

// 22P02 (malformed uuid/number/enum) is a client error: 400. Everything else is a 500 that says nothing about the DB.
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

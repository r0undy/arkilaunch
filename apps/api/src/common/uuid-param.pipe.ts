import { BadRequestException, Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';

// Every route param is a uuid; a malformed one must 400, not reach Postgres as a 500 (even on @Public routes).
// Route params only: bodies and queries are the ZodValidationPipe's job.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isIdParam(name: unknown): boolean {
  return typeof name === 'string' && (name === 'id' || name.endsWith('Id'));
}

@Injectable()
export class UuidParamPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'param' || !isIdParam(metadata.data)) return value;
    if (typeof value !== 'string' || !UUID_RE.test(value)) {
      throw new BadRequestException({ error: 'invalid_uuid', param: metadata.data });
    }
    return value;
  }
}

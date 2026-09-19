import { BadRequestException, Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';

// Every route param in this API is an id (`id`, `assignmentId`,
// `reconciliationId`) and every one of them is a uuid column. None was
// validated: there is no ParseUUIDPipe anywhere, so
// `GET /catalog/equipment/foo` reached Postgres, raised
// `invalid input syntax for type uuid`, and escaped as an uncaught 500 --
// unauthenticated, on a @Public route (audit-api-surface.md #6).
//
// Registered globally rather than repeated on 37 params. It deliberately
// only inspects route params: bodies and queries are the
// ZodValidationPipe's job, and a global ParseUUIDPipe would try to parse
// those too.
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

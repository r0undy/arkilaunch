import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { db } from '@arkilaunch/db';
import { Public } from '../common/decorators/public.decorator.js';

// Unauthenticated, no tenant context — a deployment smoke-test target only.
// Runs a trivial query so "API is up" and "API can reach Postgres" are not
// the same green light.
@Controller('health')
@Public()
export class HealthController {
  @Get()
  async check() {
    try {
      await db.execute(sql`select 1`);
    } catch {
      throw new ServiceUnavailableException({ status: 'db_unreachable' });
    }
    return { status: 'ok' };
  }
}

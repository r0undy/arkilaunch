import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';

// Unauthenticated, no tenant context — a deployment smoke-test target only.
@Controller('health')
@Public()
export class HealthController {
  @Get()
  check() {
    return { status: 'ok' };
  }
}

import { Body, Controller, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { Enroll2faConfirmDto } from './dto.js';
import type { CtxRequest } from '../common/request.js';

// NOT @Public(): enrolling needs an authenticated, tenant-scoped caller.
@Controller('auth/2fa')
export class TwoFaController {
  constructor(private readonly auth: AuthService) {}

  @Post('enroll')
  enroll(@Req() req: CtxRequest) {
    // The claims carry no email; the user id is a fine authenticator label.
    return this.auth.enroll(req.ctx.userId);
  }

  @Post('enroll/confirm')
  enrollConfirm(@Body() body: Enroll2faConfirmDto, @Req() req: CtxRequest) {
    return this.auth.enrollConfirm(req.ctx, body);
  }
}

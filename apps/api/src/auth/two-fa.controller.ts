import { Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';
import { AuthService } from './auth.service.js';
import { Enroll2faConfirmDto } from './dto.js';

type CtxRequest = Request & { ctx: RequestContext };

// Unlike AuthController, this one is NOT @Public(): enrolling 2FA requires
// an authenticated, tenant-scoped caller (an unenrolled timekeeper still
// gets a normal access token from login(), see auth.service.ts).
@Controller('auth/2fa')
export class TwoFaController {
  constructor(private readonly auth: AuthService) {}

  @Post('enroll')
  enroll(@Req() req: CtxRequest) {
    // JwtStrategy's JwtClaimsSchema does not carry email; the enroll step
    // only needs *a* label for the authenticator app, so the user id is a
    // perfectly good fallback account label.
    return this.auth.enroll(req.ctx.userId);
  }

  @Post('enroll/confirm')
  enrollConfirm(@Body() body: Enroll2faConfirmDto, @Req() req: CtxRequest) {
    return this.auth.enrollConfirm(req.ctx, body);
  }
}

import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { AuthService } from './auth.service.js';
import { LoginDto, RefreshDto, Verify2faDto } from './dto.js';

// Public: no tenant context yet (RFC-1 §3). 2fa/verify stays here (also
// public) because at that point the caller holds only a single-purpose
// challenge token, not a normal Bearer access token -- enroll/enroll/confirm
// live in TwoFaController instead, since those DO need an authenticated ctx.
@Controller('auth')
@Public()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: LoginDto) {
    return this.auth.login(body);
  }

  @Post('refresh')
  refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body);
  }

  @Post('2fa/verify')
  verifyTwoFa(@Body() body: Verify2faDto) {
    return this.auth.verifyTwoFa(body);
  }
}

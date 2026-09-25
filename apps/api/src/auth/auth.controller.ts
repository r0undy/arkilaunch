import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator.js';
import { LoginTenantSlug, StorefrontSlug } from '../common/decorators/tenant-slug.decorator.js';
import { AuthService } from './auth.service.js';
import { ForgotPasswordDto, LoginDto, RefreshDto, UserActivateDto, Verify2faDto } from './dto.js';
import { CustomerSignupDto } from '../customers/dto.js';

// Public: no tenant context yet (RFC-1 §3). 2fa/verify stays here (also
// public) because at that point the caller holds only a single-purpose
// challenge token, not a normal Bearer access token -- enroll/enroll/confirm
// live in TwoFaController instead, since those DO need an authenticated ctx.
// activate (S19) is the same shape: the caller holds only a single-purpose
// activation token, not a Bearer access token.
@Controller('auth')
@Public()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() body: LoginDto, @LoginTenantSlug() tenantSlug: string) {
    return this.auth.login(body, tenantSlug);
  }

  // Customer self-signup (customer prerequisites CR). Throttled hard: it
  // is an unauthenticated write that spends an argon2 hash.
  @Post('register-customer')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  registerCustomer(@Body() body: CustomerSignupDto, @StorefrontSlug() tenantSlug: string) {
    return this.auth.registerCustomer(body, tenantSlug);
  }

  // Always 200 whether or not the email has an account (no enumeration).
  // Throttled: each call can drop a row into every admin's feed.
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  forgotPassword(@Body() body: ForgotPasswordDto, @LoginTenantSlug() tenantSlug: string) {
    return this.auth.forgotPassword(body, tenantSlug);
  }

  @Post('refresh')
  refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body);
  }

  @Post('2fa/verify')
  verifyTwoFa(@Body() body: Verify2faDto) {
    return this.auth.verifyTwoFa(body);
  }

  // POST /auth/activate (S19): completes an invite from UsersService.invite().
  @Post('activate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async activate(@Body() body: UserActivateDto): Promise<void> {
    await this.auth.activate(body);
  }
}

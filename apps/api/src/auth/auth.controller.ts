import { Body, Controller, Headers, HttpCode, HttpStatus, Ip, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator.js';
import { LoginTenantSlug, StorefrontSlug } from '../common/decorators/tenant-slug.decorator.js';
import { TURNSTILE_HEADER, TurnstileGuard } from '../common/turnstile.js';
import { AuthService } from './auth.service.js';
import { ForgotPasswordDto, LoginDto, RefreshDto, UserActivateDto, Verify2faDto } from './dto.js';
import { CustomerSignupDto } from '../customers/dto.js';

// Public: no tenant context yet. 2fa/verify and activate live here because the caller holds only a
// single-purpose token, not a Bearer access token.
@Controller('auth')
@Public()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Turnstile only after repeated failures, so a normal sign-in never sees the widget.
  @Post('login')
  login(
    @Body() body: LoginDto,
    @LoginTenantSlug() tenantSlug: string,
    @Ip() ip: string,
    @Headers(TURNSTILE_HEADER) turnstileToken?: string,
  ) {
    return this.auth.login(body, tenantSlug, ip, turnstileToken);
  }

  // Throttled hard: an unauthenticated write that spends an argon2 hash.
  @Post('register-customer')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(TurnstileGuard)
  registerCustomer(@Body() body: CustomerSignupDto, @StorefrontSlug() tenantSlug: string) {
    return this.auth.registerCustomer(body, tenantSlug);
  }

  // Always 200 whether or not the email has an account (no enumeration).
  // Throttled: each call can drop a row into every admin's feed.
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(TurnstileGuard)
  forgotPassword(@Body() body: ForgotPasswordDto, @LoginTenantSlug() tenantSlug: string) {
    return this.auth.forgotPassword(body, tenantSlug);
  }

  @Post('refresh')
  refresh(@Body() body: RefreshDto) {
    return this.auth.refresh(body);
  }

  @Post('2fa/verify')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  verifyTwoFa(@Body() body: Verify2faDto) {
    return this.auth.verifyTwoFa(body);
  }

  @Post('activate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async activate(@Body() body: UserActivateDto): Promise<void> {
    await this.auth.activate(body);
  }
}

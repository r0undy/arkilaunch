import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator.js';
import { AuthService } from './auth.service.js';
import { LoginDto, RefreshDto } from './dto.js';

// Public: no tenant context yet (RFC-1 §3).
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
}

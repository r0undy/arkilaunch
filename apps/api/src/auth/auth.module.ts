import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtStrategy } from './jwt.strategy.js';
import { RefreshTokenService } from './refresh-token.service.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\\n/g, '\n');
}

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      privateKey: requireEnv('JWT_PRIVATE_KEY'),
      publicKey: requireEnv('JWT_PUBLIC_KEY'),
      signOptions: { algorithm: 'RS256' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokenService, JwtStrategy],
  exports: [JwtModule, PassportModule],
})
export class AuthModule {}

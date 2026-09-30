import { z } from 'zod';

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const ForgotPasswordRequestSchema = LoginRequestSchema.pick({ email: true });
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const AuthTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(),
});
export type AuthTokens = z.infer<typeof AuthTokensSchema>;

// Never trust a client-supplied tenantId: this is only ever produced by verifying a signed access token.
export const JwtClaimsSchema = z.object({
  sub: z.string().uuid(), // user id
  tenantId: z.string().uuid(),
  role: z.string(),
  iat: z.number(),
  exp: z.number(),
});
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

// Carries no tokens, only a single-purpose challenge that cannot satisfy JwtClaimsSchema as a Bearer.
export const TwoFaChallengeSchema = z.object({
  requires2fa: z.literal(true),
  twoFaToken: z.string(),
});
export type TwoFaChallenge = z.infer<typeof TwoFaChallengeSchema>;

export const Verify2faRequestSchema = z.object({
  twoFaToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});
export type Verify2faRequest = z.infer<typeof Verify2faRequestSchema>;

export const Enroll2faConfirmRequestSchema = z.object({
  secret: z.string().min(1),
  code: z.string().regex(/^\d{6}$/),
});
export type Enroll2faConfirmRequest = z.infer<typeof Enroll2faConfirmRequestSchema>;

import { z } from 'zod';

// Boundary schemas for the identity/auth surface (RFC-1 §3). Shared client and server
// so there is exactly one definition of "what a login/refresh request looks like".

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

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

// JWT claims. Never trust a client-supplied tenantId; this shape is only ever
// produced by verifying a signed access token (AGENTS.md "Never" list).
export const JwtClaimsSchema = z.object({
  sub: z.string().uuid(), // user id
  tenantId: z.string().uuid(),
  role: z.string(),
  iat: z.number(),
  exp: z.number(),
});
export type JwtClaims = z.infer<typeof JwtClaimsSchema>;

// The login response when a second factor is still owed (PRD-F3 US-02,
// PRD-F7 US-07: timekeepers enroll TOTP and pass it before EDTR access).
// This is a discriminated shape, not AuthTokens: `requires2fa: true` carries
// no access/refresh token, only a short-lived, single-purpose challenge
// token (see auth.service.ts / jwt.strategy.ts -- it deliberately does not
// satisfy JwtClaimsSchema, so it can never be replayed as a Bearer token on
// a normal guarded route).
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

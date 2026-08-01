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

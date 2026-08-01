import { SetMetadata } from '@nestjs/common';

// RFC-1 §3: "applied globally to /api/v1/** except the public and auth
// routes." @Public() is how a route opts out of the global guard chain.
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

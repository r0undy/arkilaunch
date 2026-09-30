import type { Request } from 'express';
import type { RequestContext } from '@arkilaunch/shared';

export type CtxRequest = Request & { ctx: RequestContext };
export type MulterFile = { buffer: Buffer; size: number; mimetype: string };

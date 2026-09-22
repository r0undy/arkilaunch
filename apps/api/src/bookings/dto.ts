import { createZodDto } from 'nestjs-zod';
import {
  BookingCreateRequestSchema,
  BookingListQuerySchema,
  ChangeRequestCreateSchema,
  ChangeRequestResolveSchema,
  NegotiationMessageCreateSchema,
} from '@arkilaunch/shared';

export class BookingCreateDto extends createZodDto(BookingCreateRequestSchema) {}
export class BookingListQueryDto extends createZodDto(BookingListQuerySchema) {}
export class NegotiationMessageCreateDto extends createZodDto(NegotiationMessageCreateSchema) {}
export class ChangeRequestCreateDto extends createZodDto(ChangeRequestCreateSchema) {}
export class ChangeRequestResolveDto extends createZodDto(ChangeRequestResolveSchema) {}

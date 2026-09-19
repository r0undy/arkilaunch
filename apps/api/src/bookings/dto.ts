import { createZodDto } from 'nestjs-zod';
import { BookingCreateRequestSchema, BookingListQuerySchema } from '@arkilaunch/shared';

export class BookingCreateDto extends createZodDto(BookingCreateRequestSchema) {}
export class BookingListQueryDto extends createZodDto(BookingListQuerySchema) {}

import { createZodDto } from 'nestjs-zod';
import { BookingCreateRequestSchema } from '@arkilaunch/shared';

export class BookingCreateDto extends createZodDto(BookingCreateRequestSchema) {}

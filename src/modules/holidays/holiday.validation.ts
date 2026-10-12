import { z } from 'zod';
import { calendarDate, id, optionalQuery, optionalText, requiredText, searchQuery } from '@/lib/validation';

/** `GET /holidays` query: `year`, `search` (name). */
export const holidayListQuery = z.object({
  year: optionalQuery(
    z.coerce
      .number({ error: 'Use a year such as 2026' })
      .int('Use a year such as 2026')
      .min(1970, 'Use a year such as 2026')
      .max(9999, 'Use a year such as 2026'),
  ),
  search: searchQuery(),
});

export type HolidayListQuery = z.output<typeof holidayListQuery>;

/** `POST /holidays` and `PATCH /holidays/{id}` body (`holidays.create.request.json`). */
export const holidayBody = z.object({
  date: calendarDate('Date'),
  name: requiredText('Holiday name', 100),
  description: optionalText(500),
});

export type HolidayBody = z.output<typeof holidayBody>;

export const holidayIdParam = z.object({ id: id('holiday') });

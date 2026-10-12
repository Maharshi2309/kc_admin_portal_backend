import type { CalendarDate } from '@/lib/time';

/** A company holiday as the app reads it (`holidays.get.response.json`). */
export type HolidayDto = {
  id: string;
  date: CalendarDate;
  name: string;
  description: string | null;
};

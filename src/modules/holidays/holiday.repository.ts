import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { dateToDb } from '@/lib/time';
import type { HolidayBody, HolidayListQuery } from './holiday.validation';

const holidaySelect = { id: true, date: true, name: true, description: true } satisfies Prisma.CompanyHolidaySelect;

export type HolidayRow = Prisma.CompanyHolidayGetPayload<{ select: typeof holidaySelect }>;

/** Holidays not deleted, by date. */
export function listHolidays(query: HolidayListQuery): Promise<HolidayRow[]> {
  return db().companyHoliday.findMany({
    where: {
      deletedAt: null,
      ...(query.year
        ? { date: { gte: dateToDb(`${query.year}-01-01`), lte: dateToDb(`${query.year}-12-31`) } }
        : {}),
      ...(query.search ? { name: { contains: query.search } } : {}),
    },
    select: holidaySelect,
    orderBy: { date: 'asc' },
  });
}

export function findHoliday(id: number, client: Prisma.TransactionClient = db()): Promise<HolidayRow | null> {
  return client.companyHoliday.findFirst({ where: { id, deletedAt: null }, select: holidaySelect });
}

/** The live holiday on [date], other than [exceptId]. */
export function holidayOn(date: string, exceptId: number | null, client: Prisma.TransactionClient) {
  return client.companyHoliday.findFirst({
    where: { date: dateToDb(date), deletedAt: null, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: holidaySelect,
  });
}

export function createHoliday(tx: Prisma.TransactionClient, body: HolidayBody, actorId: number) {
  return tx.companyHoliday.create({
    data: { ...body, date: dateToDb(body.date), liveDate: dateToDb(body.date), createdById: actorId, updatedById: actorId },
    select: holidaySelect,
  });
}

export function updateHoliday(tx: Prisma.TransactionClient, id: number, body: HolidayBody, actorId: number) {
  return tx.companyHoliday.update({
    where: { id },
    data: { ...body, date: dateToDb(body.date), liveDate: dateToDb(body.date), updatedById: actorId },
    select: holidaySelect,
  });
}

export async function softDeleteHoliday(tx: Prisma.TransactionClient, id: number, actorId: number, at: Date) {
  await tx.companyHoliday.update({ where: { id }, data: { deletedAt: at, deletedById: actorId, liveDate: null } });
}

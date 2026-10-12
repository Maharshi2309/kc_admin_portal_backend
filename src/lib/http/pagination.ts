import { z } from 'zod';

/**
 * Pagination as the app sends and reads it (API_CONTRACT.md §1):
 * query `page` (1-based) and `pageSize`; response
 * `{ items, total, page, pageSize }` plus endpoint-specific extras such as
 * `counts`.
 *
 * PROPOSED DEFAULT — CLIENT CONFIRMATION OPTIONAL: default page size 10
 * (attendance passes 20, matching the app), maximum 100.
 */
export const PAGINATION = { defaultPageSize: 10, maxPageSize: 100 } as const;

export type PageRequest = { page: number; pageSize: number; skip: number; take: number };

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

/** The `page` and `pageSize` fields, to spread into an endpoint's query schema. */
export function paginationFields(defaultPageSize: number = PAGINATION.defaultPageSize) {
  return {
    page: z.coerce
      .number({ error: 'Must be a whole number' })
      .int('Must be a whole number')
      .min(1, 'Must be 1 or more')
      .default(1),
    pageSize: z.coerce
      .number({ error: 'Must be a whole number' })
      .int('Must be a whole number')
      .min(1, 'Must be 1 or more')
      .max(PAGINATION.maxPageSize, `Must be at most ${PAGINATION.maxPageSize}`)
      .default(defaultPageSize),
  };
}

export function pageRequestOf({ page, pageSize }: { page: number; pageSize: number }): PageRequest {
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/** Query schema with only `page` and `pageSize`, parsed to a [PageRequest]. */
export function paginationQuery(defaultPageSize: number = PAGINATION.defaultPageSize) {
  return z.object(paginationFields(defaultPageSize)).transform(pageRequestOf);
}

/** A page past the end is valid: empty `items`, real `total`. */
export function toPage<T>(items: T[], total: number, request: PageRequest): Page<T> {
  return { items, total, page: request.page, pageSize: request.pageSize };
}

/** Pages a list that is already in memory (e.g. derived attendance rows). */
export function pageOf<T>(all: readonly T[], request: PageRequest): Page<T> {
  return toPage(all.slice(request.skip, request.skip + request.take), all.length, request);
}

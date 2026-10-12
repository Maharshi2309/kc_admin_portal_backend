import { describe, expect, it } from 'vitest';
import { pageOf, toPage } from '@/lib/http/pagination';

const request = (page: number, pageSize: number) => ({
  page,
  pageSize,
  skip: (page - 1) * pageSize,
  take: pageSize,
});

describe('pagination', () => {
  it('builds the app page shape', () => {
    expect(toPage(['a'], 124, request(1, 10))).toEqual({
      items: ['a'],
      total: 124,
      page: 1,
      pageSize: 10,
    });
  });

  it('pages an in-memory list', () => {
    const all = Array.from({ length: 25 }, (_, i) => i + 1);
    expect(pageOf(all, request(3, 10))).toEqual({
      items: [21, 22, 23, 24, 25],
      total: 25,
      page: 3,
      pageSize: 10,
    });
  });

  it('returns no items past the end, keeping the real total', () => {
    expect(pageOf([1, 2, 3], request(5, 10))).toEqual({
      items: [],
      total: 3,
      page: 5,
      pageSize: 10,
    });
  });
});

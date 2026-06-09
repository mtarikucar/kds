export interface PaginatedMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginatedMeta;
}

export function paginated<T>(
  data: T[],
  total: number,
  page: number = 1,
  limit: number = data.length || 1,
): PaginatedResult<T> {
  const safeLimit = Math.max(1, limit);
  return {
    data,
    meta: {
      total,
      page,
      limit: safeLimit,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
}

/**
 * @workspace/backend-common
 * Centralized Keyset / Cursor Pagination Engine
 *
 * Provides high-performance, O(1) database keyset pagination, robust cursor encoding/decoding,
 * and standard request parameter extraction across all 180workspace modules.
 */

export type PaginationDirection = 'forward' | 'backward';

export interface CursorPayload {
  id: string;
  sortValue: any;
  [key: string]: any;
}

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
  totalCount?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pageInfo: PageInfo;
}

export interface PaginationOptions {
  cursor?: string | null;
  limit?: number;
  direction?: PaginationDirection;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  includeTotalCount?: boolean;
  where?: any;
  select?: any;
  include?: any;
}

export interface ExtractedPaginationParams {
  cursor?: string | null;
  limit: number;
  direction: PaginationDirection;
  page?: number;
  sortField: string;
  sortOrder: 'asc' | 'desc';
}

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Encodes cursor payload into an opaque URL-safe base64 string.
 */
export function encodeCursor(payload: CursorPayload): string {
  try {
    const json = JSON.stringify(payload);
    return Buffer.from(json, 'utf8').toString('base64url');
  } catch {
    return '';
  }
}

/**
 * Decodes opaque URL-safe base64 cursor string into payload.
 * Gracefully handles malformed or tampered cursors without throwing errors.
 */
export function decodeCursor(cursorStr?: string | null): CursorPayload | null {
  if (!cursorStr || typeof cursorStr !== 'string') return null;

  try {
    const json = Buffer.from(cursorStr, 'base64url').toString('utf8');
    const parsed = JSON.parse(json);

    if (!parsed || typeof parsed !== 'object' || !parsed.id) {
      return null;
    }

    // Auto-convert ISO date strings back into Date objects for Prisma
    if (typeof parsed.sortValue === 'string' && ISO_DATE_REGEX.test(parsed.sortValue)) {
      const parsedDate = new Date(parsed.sortValue);
      if (!isNaN(parsedDate.getTime())) {
        parsed.sortValue = parsedDate;
      }
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Extracts and sanitizes standard pagination parameters from HTTP request queries.
 */
export function extractPaginationParams(query: Record<string, any> = {}): ExtractedPaginationParams {
  let rawLimit = parseInt(query.limit, 10);
  if (isNaN(rawLimit) || rawLimit <= 0) {
    rawLimit = DEFAULT_PAGE_SIZE;
  }
  const limit = Math.min(rawLimit, MAX_PAGE_SIZE);

  const direction: PaginationDirection =
    query.direction === 'backward' ? 'backward' : 'forward';

  const sortField = query.sortField && typeof query.sortField === 'string' ? query.sortField : 'createdAt';
  const sortOrder: 'asc' | 'desc' = query.sortOrder === 'asc' ? 'asc' : 'desc';

  const cursor = typeof query.cursor === 'string' && query.cursor.trim().length > 0
    ? query.cursor.trim()
    : null;

  let page: number | undefined = undefined;
  if (query.page !== undefined) {
    const parsedPage = parseInt(query.page, 10);
    if (!isNaN(parsedPage) && parsedPage > 0) {
      page = parsedPage;
    }
  }

  return {
    cursor,
    limit,
    direction,
    page,
    sortField,
    sortOrder
  };
}

/**
 * High-performance Keyset/Cursor Pagination Engine.
 * Executes O(1) index seeks rather than O(N) offset scans.
 */
export async function paginateWithCursor<T = any>(
  modelDelegate: any,
  options: PaginationOptions = {}
): Promise<PaginatedResult<T>> {
  const limit = Math.max(1, Math.min(options.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
  const direction = options.direction || 'forward';
  const sortField = options.sortField || 'createdAt';
  const sortOrder = options.sortOrder || 'desc';
  const isDesc = sortOrder === 'desc';

  const decoded = decodeCursor(options.cursor);

  // Build the Keyset WHERE clause
  const baseWhere = options.where ? { ...options.where } : {};
  let keysetWhere: any = {};

  if (decoded) {
    const { id, sortValue } = decoded;

    if (direction === 'forward') {
      // Forward: Next items
      if (isDesc) {
        keysetWhere = {
          OR: [
            { [sortField]: { lt: sortValue } },
            { [sortField]: sortValue, id: { lt: id } }
          ]
        };
      } else {
        keysetWhere = {
          OR: [
            { [sortField]: { gt: sortValue } },
            { [sortField]: sortValue, id: { gt: id } }
          ]
        };
      }
    } else {
      // Backward: Previous items
      if (isDesc) {
        keysetWhere = {
          OR: [
            { [sortField]: { gt: sortValue } },
            { [sortField]: sortValue, id: { gt: id } }
          ]
        };
      } else {
        keysetWhere = {
          OR: [
            { [sortField]: { lt: sortValue } },
            { [sortField]: sortValue, id: { lt: id } }
          ]
        };
      }
    }
  }

  // Combine user where with keyset where
  const combinedWhere = Object.keys(keysetWhere).length > 0
    ? {
        AND: [baseWhere, keysetWhere]
      }
    : baseWhere;

  // Determine query sorting (inverted for backward pagination)
  const querySortOrder = direction === 'backward'
    ? (isDesc ? 'asc' : 'desc')
    : sortOrder;

  const queryArgs: any = {
    where: combinedWhere,
    orderBy: [
      { [sortField]: querySortOrder },
      { id: querySortOrder }
    ],
    take: limit + 1
  };

  if (options.select) {
    queryArgs.select = options.select;
  } else if (options.include) {
    queryArgs.include = options.include;
  }

  // Execute queries in parallel if count requested
  const queries: [Promise<any[]>, Promise<number | undefined>] = [
    modelDelegate.findMany(queryArgs),
    options.includeTotalCount
      ? modelDelegate.count({ where: baseWhere })
      : Promise.resolve(undefined)
  ];

  const [rawRows, totalCount] = await Promise.all(queries);

  const hasMore = rawRows.length > limit;
  let items = hasMore ? rawRows.slice(0, limit) : rawRows;

  // Re-orient items if we navigated backward
  if (direction === 'backward') {
    items = items.reverse();
  }

  const hasNextPage = direction === 'forward' ? hasMore : Boolean(decoded);
  const hasPreviousPage = direction === 'forward' ? Boolean(decoded) : hasMore;

  const startCursor = items.length > 0
    ? encodeCursor({
        id: items[0].id,
        sortValue: items[0][sortField]
      })
    : null;

  const endCursor = items.length > 0
    ? encodeCursor({
        id: items[items.length - 1].id,
        sortValue: items[items.length - 1][sortField]
      })
    : null;

  return {
    items,
    pageInfo: {
      hasNextPage,
      hasPreviousPage,
      startCursor,
      endCursor,
      totalCount
    }
  };
}

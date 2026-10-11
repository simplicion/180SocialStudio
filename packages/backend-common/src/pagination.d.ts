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
/**
 * Encodes cursor payload into an opaque URL-safe base64 string.
 */
export declare function encodeCursor(payload: CursorPayload): string;
/**
 * Decodes opaque URL-safe base64 cursor string into payload.
 * Gracefully handles malformed or tampered cursors without throwing errors.
 */
export declare function decodeCursor(cursorStr?: string | null): CursorPayload | null;
/**
 * Extracts and sanitizes standard pagination parameters from HTTP request queries.
 */
export declare function extractPaginationParams(query?: Record<string, any>): ExtractedPaginationParams;
/**
 * High-performance Keyset/Cursor Pagination Engine.
 * Executes O(1) index seeks rather than O(N) offset scans.
 */
export declare function paginateWithCursor<T = any>(modelDelegate: any, options?: PaginationOptions): Promise<PaginatedResult<T>>;

"use strict";
/**
 * @workspace/backend-common
 * Centralized Keyset / Cursor Pagination Engine
 *
 * Provides high-performance, O(1) database keyset pagination, robust cursor encoding/decoding,
 * and standard request parameter extraction across all 180workspace modules.
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeCursor = encodeCursor;
exports.decodeCursor = decodeCursor;
exports.extractPaginationParams = extractPaginationParams;
exports.paginateWithCursor = paginateWithCursor;
var DEFAULT_PAGE_SIZE = 20;
var MAX_PAGE_SIZE = 100;
var ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
/**
 * Encodes cursor payload into an opaque URL-safe base64 string.
 */
function encodeCursor(payload) {
    try {
        var json = JSON.stringify(payload);
        return Buffer.from(json, 'utf8').toString('base64url');
    }
    catch (_a) {
        return '';
    }
}
/**
 * Decodes opaque URL-safe base64 cursor string into payload.
 * Gracefully handles malformed or tampered cursors without throwing errors.
 */
function decodeCursor(cursorStr) {
    if (!cursorStr || typeof cursorStr !== 'string')
        return null;
    try {
        var json = Buffer.from(cursorStr, 'base64url').toString('utf8');
        var parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object' || !parsed.id) {
            return null;
        }
        // Auto-convert ISO date strings back into Date objects for Prisma
        if (typeof parsed.sortValue === 'string' && ISO_DATE_REGEX.test(parsed.sortValue)) {
            var parsedDate = new Date(parsed.sortValue);
            if (!isNaN(parsedDate.getTime())) {
                parsed.sortValue = parsedDate;
            }
        }
        return parsed;
    }
    catch (_a) {
        return null;
    }
}
/**
 * Extracts and sanitizes standard pagination parameters from HTTP request queries.
 */
function extractPaginationParams(query) {
    if (query === void 0) { query = {}; }
    var rawLimit = parseInt(query.limit, 10);
    if (isNaN(rawLimit) || rawLimit <= 0) {
        rawLimit = DEFAULT_PAGE_SIZE;
    }
    var limit = Math.min(rawLimit, MAX_PAGE_SIZE);
    var direction = query.direction === 'backward' ? 'backward' : 'forward';
    var sortField = query.sortField && typeof query.sortField === 'string' ? query.sortField : 'createdAt';
    var sortOrder = query.sortOrder === 'asc' ? 'asc' : 'desc';
    var cursor = typeof query.cursor === 'string' && query.cursor.trim().length > 0
        ? query.cursor.trim()
        : null;
    var page = undefined;
    if (query.page !== undefined) {
        var parsedPage = parseInt(query.page, 10);
        if (!isNaN(parsedPage) && parsedPage > 0) {
            page = parsedPage;
        }
    }
    return {
        cursor: cursor,
        limit: limit,
        direction: direction,
        page: page,
        sortField: sortField,
        sortOrder: sortOrder
    };
}
/**
 * High-performance Keyset/Cursor Pagination Engine.
 * Executes O(1) index seeks rather than O(N) offset scans.
 */
function paginateWithCursor(modelDelegate_1) {
    return __awaiter(this, arguments, void 0, function (modelDelegate, options) {
        var limit, direction, sortField, sortOrder, isDesc, decoded, baseWhere, keysetWhere, id, sortValue, combinedWhere, querySortOrder, queryArgs, queries, _a, rawRows, totalCount, hasMore, items, hasNextPage, hasPreviousPage, startCursor, endCursor;
        var _b, _c, _d, _e, _f, _g, _h, _j, _k;
        if (options === void 0) { options = {}; }
        return __generator(this, function (_l) {
            switch (_l.label) {
                case 0:
                    limit = Math.max(1, Math.min(options.limit || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE));
                    direction = options.direction || 'forward';
                    sortField = options.sortField || 'createdAt';
                    sortOrder = options.sortOrder || 'desc';
                    isDesc = sortOrder === 'desc';
                    decoded = decodeCursor(options.cursor);
                    baseWhere = options.where ? __assign({}, options.where) : {};
                    keysetWhere = {};
                    if (decoded) {
                        id = decoded.id, sortValue = decoded.sortValue;
                        if (direction === 'forward') {
                            // Forward: Next items
                            if (isDesc) {
                                keysetWhere = {
                                    OR: [
                                        (_b = {}, _b[sortField] = { lt: sortValue }, _b),
                                        (_c = {}, _c[sortField] = sortValue, _c.id = { lt: id }, _c)
                                    ]
                                };
                            }
                            else {
                                keysetWhere = {
                                    OR: [
                                        (_d = {}, _d[sortField] = { gt: sortValue }, _d),
                                        (_e = {}, _e[sortField] = sortValue, _e.id = { gt: id }, _e)
                                    ]
                                };
                            }
                        }
                        else {
                            // Backward: Previous items
                            if (isDesc) {
                                keysetWhere = {
                                    OR: [
                                        (_f = {}, _f[sortField] = { gt: sortValue }, _f),
                                        (_g = {}, _g[sortField] = sortValue, _g.id = { gt: id }, _g)
                                    ]
                                };
                            }
                            else {
                                keysetWhere = {
                                    OR: [
                                        (_h = {}, _h[sortField] = { lt: sortValue }, _h),
                                        (_j = {}, _j[sortField] = sortValue, _j.id = { lt: id }, _j)
                                    ]
                                };
                            }
                        }
                    }
                    combinedWhere = Object.keys(keysetWhere).length > 0
                        ? {
                            AND: [baseWhere, keysetWhere]
                        }
                        : baseWhere;
                    querySortOrder = direction === 'backward'
                        ? (isDesc ? 'asc' : 'desc')
                        : sortOrder;
                    queryArgs = {
                        where: combinedWhere,
                        orderBy: [
                            (_k = {}, _k[sortField] = querySortOrder, _k),
                            { id: querySortOrder }
                        ],
                        take: limit + 1
                    };
                    if (options.select) {
                        queryArgs.select = options.select;
                    }
                    else if (options.include) {
                        queryArgs.include = options.include;
                    }
                    queries = [
                        modelDelegate.findMany(queryArgs),
                        options.includeTotalCount
                            ? modelDelegate.count({ where: baseWhere })
                            : Promise.resolve(undefined)
                    ];
                    return [4 /*yield*/, Promise.all(queries)];
                case 1:
                    _a = __read.apply(void 0, [_l.sent(), 2]), rawRows = _a[0], totalCount = _a[1];
                    hasMore = rawRows.length > limit;
                    items = hasMore ? rawRows.slice(0, limit) : rawRows;
                    // Re-orient items if we navigated backward
                    if (direction === 'backward') {
                        items = items.reverse();
                    }
                    hasNextPage = direction === 'forward' ? hasMore : Boolean(decoded);
                    hasPreviousPage = direction === 'forward' ? Boolean(decoded) : hasMore;
                    startCursor = items.length > 0
                        ? encodeCursor({
                            id: items[0].id,
                            sortValue: items[0][sortField]
                        })
                        : null;
                    endCursor = items.length > 0
                        ? encodeCursor({
                            id: items[items.length - 1].id,
                            sortValue: items[items.length - 1][sortField]
                        })
                        : null;
                    return [2 /*return*/, {
                            items: items,
                            pageInfo: {
                                hasNextPage: hasNextPage,
                                hasPreviousPage: hasPreviousPage,
                                startCursor: startCursor,
                                endCursor: endCursor,
                                totalCount: totalCount
                            }
                        }];
            }
        });
    });
}

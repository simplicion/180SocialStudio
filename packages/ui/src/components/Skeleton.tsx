'use client';

import React from 'react';
import clsx from 'clsx';

export interface SkeletonProps {
    className?: string;
    variant?: 'text' | 'circular' | 'rectangular' | 'rounded' | 'pill';
    width?: string | number;
    height?: string | number;
    animate?: 'pulse' | 'shimmer' | 'glow' | 'none';
    style?: React.CSSProperties;
}

/**
 * Base primitive Skeleton component supporting dark mode, shimmer animations, and multiple shape variants.
 */
export default function Skeleton({
    className,
    variant = 'rectangular',
    width,
    height,
    animate = 'shimmer',
    style: customStyle,
}: SkeletonProps) {
    const style: React.CSSProperties = {
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
        ...customStyle,
    };

    return (
        <div
            className={clsx(
                'bg-zinc-200/80 dark:bg-zinc-800/80 overflow-hidden relative select-none',
                {
                    'rounded-full': variant === 'circular' || variant === 'pill',
                    'rounded-xl': variant === 'rounded',
                    'rounded-md': variant === 'text',
                    'rounded-none': variant === 'rectangular',
                    'animate-pulse': animate === 'pulse' || animate === 'shimmer',
                    'shadow-[0_0_15px_rgba(99,102,241,0.15)]': animate === 'glow',
                },
                className
            )}
            style={style}
            aria-hidden="true"
        >
            {animate === 'shimmer' && (
                <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/30 dark:via-white/5 to-transparent pointer-events-none" />
            )}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * Primitive Micro-Skeletons
 * ───────────────────────────────────────────────────────────── */

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
    const widths = ['100%', '85%', '65%', '92%', '45%', '78%'];
    return (
        <div className={clsx('space-y-2', className)}>
            {Array.from({ length: lines }).map((_, i) => (
                <Skeleton
                    key={i}
                    variant="text"
                    width={widths[i % widths.length]}
                    height={12}
                />
            ))}
        </div>
    );
}

export function SkeletonAvatar({ size = 36, hasBadge = false, className }: { size?: number; hasBadge?: boolean; className?: string }) {
    return (
        <div className={clsx('relative shrink-0', className)}>
            <Skeleton variant="circular" width={size} height={size} />
            {hasBadge && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-zinc-300 dark:bg-zinc-700 border-2 border-white dark:border-zinc-900" />
            )}
        </div>
    );
}

export function SkeletonButton({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
    const heightMap = { sm: 28, md: 36, lg: 44 };
    const widthMap = { sm: 64, md: 88, lg: 112 };
    return (
        <Skeleton
            variant="rounded"
            width={widthMap[size]}
            height={heightMap[size]}
            className={clsx('rounded-xl shrink-0', className)}
        />
    );
}

export function SkeletonBadge({ width = 56, className }: { width?: number | string; className?: string }) {
    return (
        <Skeleton
            variant="pill"
            width={width}
            height={20}
            className={clsx('shrink-0', className)}
        />
    );
}

export function SkeletonInput({ hasLabel = true, className }: { hasLabel?: boolean; className?: string }) {
    return (
        <div className={clsx('space-y-1.5 w-full', className)}>
            {hasLabel && <Skeleton variant="text" width={72} height={12} />}
            <Skeleton variant="rounded" width="100%" height={38} className="rounded-xl" />
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 1. Financial Trajectory & Executive Chart Skeleton
 * ───────────────────────────────────────────────────────────── */
export function SkeletonFinancialTrajectory() {
    return (
        <div className="card overflow-hidden bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-2xl animate-pulse">
            {/* Header + KPIs */}
            <div className="p-4 sm:p-5 border-b border-zinc-100 dark:border-zinc-800 flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-emerald-100/70 dark:bg-emerald-950/40" />
                        <div className="space-y-1.5">
                            <div className="h-4 w-36 bg-zinc-200 dark:bg-zinc-700 rounded-md" />
                            <div className="h-3 w-52 bg-zinc-100 dark:bg-zinc-800 rounded" />
                        </div>
                    </div>
                    <div className="h-7 w-24 bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
                </div>

                {/* KPI mini-cards */}
                <div className="grid grid-cols-3 gap-2 w-full">
                    {[
                        { bg: 'bg-emerald-50/60 dark:bg-emerald-950/30', border: 'border-emerald-100/60 dark:border-emerald-900/40' },
                        { bg: 'bg-rose-50/60 dark:bg-rose-950/30', border: 'border-rose-100/60 dark:border-rose-900/40' },
                        { bg: 'bg-indigo-50/60 dark:bg-indigo-950/30', border: 'border-indigo-100/60 dark:border-indigo-900/40' },
                    ].map((style, i) => (
                        <div key={i} className={`flex flex-col gap-2 p-2.5 rounded-xl border ${style.border} ${style.bg}`}>
                            <div className="flex items-center gap-1.5">
                                <div className="w-3.5 h-3.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
                                <div className="h-2.5 w-16 bg-zinc-200 dark:bg-zinc-700 rounded" />
                            </div>
                            <div className="h-4 w-12 bg-zinc-300 dark:bg-zinc-600 rounded" />
                        </div>
                    ))}
                </div>
            </div>

            {/* Chart Area */}
            <div className="p-5 flex flex-col justify-between h-[280px]">
                <div className="flex items-center justify-center gap-6 mb-2">
                    <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-400/60" />
                        <div className="h-2.5 w-20 bg-zinc-200 dark:bg-zinc-700 rounded" />
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-rose-400/60" />
                        <div className="h-2.5 w-20 bg-zinc-200 dark:bg-zinc-700 rounded" />
                    </div>
                </div>

                {/* Chart SVG Wave / Grid shimmer */}
                <div className="relative flex-1 w-full flex flex-col justify-between py-2">
                    <div className="w-full border-b border-dashed border-zinc-200 dark:border-zinc-800" />
                    <div className="w-full border-b border-dashed border-zinc-200 dark:border-zinc-800" />
                    <div className="w-full border-b border-dashed border-zinc-200 dark:border-zinc-800" />
                    <div className="w-full border-b border-dashed border-zinc-200 dark:border-zinc-800" />

                    <svg className="absolute inset-0 w-full h-full opacity-25 overflow-hidden" preserveAspectRatio="none" viewBox="0 0 400 160">
                        <path
                            d="M 0 130 Q 80 70, 160 100 T 300 40 T 400 60 L 400 160 L 0 160 Z"
                            fill="url(#revSkeletonGradient)"
                        />
                        <path
                            d="M 0 145 Q 80 110, 160 125 T 300 95 T 400 105 L 400 160 L 0 160 Z"
                            fill="url(#costSkeletonGradient)"
                        />
                        <defs>
                            <linearGradient id="revSkeletonGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#10b981" stopOpacity="0.4" />
                                <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                            </linearGradient>
                            <linearGradient id="costSkeletonGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#ef4444" stopOpacity="0.3" />
                                <stop offset="100%" stopColor="#ef4444" stopOpacity="0.0" />
                            </linearGradient>
                        </defs>
                    </svg>
                </div>

                {/* Bottom X-Axis labels */}
                <div className="flex items-center justify-between pt-3 border-t border-zinc-100 dark:border-zinc-800 px-2">
                    {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                        <div key={n} className="h-2.5 w-6 bg-zinc-200/80 dark:bg-zinc-700/80 rounded" />
                    ))}
                </div>
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 2. Focus Stream & Live Deck Skeleton
 * ───────────────────────────────────────────────────────────── */
export function SkeletonFocusCard({ width = 'w-[280px] sm:w-[310px]' }: { width?: string }) {
    return (
        <div className={clsx(
            width,
            "shrink-0 p-3.5 rounded-xl border bg-white dark:bg-zinc-900/90 border-zinc-200/80 dark:border-zinc-800 flex flex-col justify-between h-[155px] animate-pulse relative overflow-hidden"
        )}>
            <div className="absolute top-0 left-0 right-0 h-1 bg-zinc-200 dark:bg-zinc-700" />
            <div>
                <div className="flex items-center justify-between gap-2 mb-2.5 mt-0.5">
                    <div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
                    <div className="h-3 w-16 bg-zinc-100 dark:bg-zinc-800 rounded" />
                </div>
                <div className="h-4 w-3/4 bg-zinc-200 dark:bg-zinc-800 rounded mb-1.5" />
                <div className="h-3 w-1/2 bg-zinc-100 dark:bg-zinc-800 rounded" />
            </div>
            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800/80 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <div className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-800" />
                    <div className="h-3 w-16 bg-zinc-100 dark:bg-zinc-800 rounded" />
                </div>
                <div className="h-5 w-14 bg-zinc-200 dark:bg-zinc-800 rounded-md" />
            </div>
        </div>
    );
}

export function SkeletonFocusStream({ count = 3 }: { count?: number }) {
    return (
        <div className="flex items-stretch gap-3 overflow-x-auto pb-1.5 pt-0.5 scrollbar-none">
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonFocusCard key={i} />
            ))}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 3. Metric & Stat Grid Skeleton
 * ───────────────────────────────────────────────────────────── */
export function SkeletonStatsCard() {
    return (
        <div className="card p-4 sm:p-5 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-2xl animate-pulse space-y-3">
            <div className="flex items-center justify-between">
                <div className="w-8 h-8 rounded-xl bg-zinc-100 dark:bg-zinc-800" />
                <div className="h-3 w-12 bg-zinc-100 dark:bg-zinc-800 rounded" />
            </div>
            <div className="h-6 w-20 bg-zinc-200 dark:bg-zinc-700 rounded-md" />
            <div className="h-3 w-32 bg-zinc-100 dark:bg-zinc-800 rounded" />
        </div>
    );
}

export function SkeletonMetricGrid({ count = 4, columns = 4 }: { count?: number; columns?: 1 | 2 | 3 | 4 | 6 }) {
    const gridCols = {
        1: 'grid-cols-1',
        2: 'grid-cols-1 sm:grid-cols-2',
        3: 'grid-cols-1 sm:grid-cols-3',
        4: 'grid-cols-2 sm:grid-cols-4',
        6: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6',
    }[columns];

    return (
        <div className={clsx('grid gap-3 sm:gap-4', gridCols)}>
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonStatsCard key={i} />
            ))}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 4. Kanban Card, Column & Board Skeleton
 * ───────────────────────────────────────────────────────────── */
export function SkeletonKanbanCard() {
    return (
        <div className="card p-3.5 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl space-y-2.5 animate-pulse">
            <div className="flex items-start gap-2">
                <div className="w-2 h-2 rounded-full bg-zinc-300 dark:bg-zinc-700 mt-1 shrink-0" />
                <div className="h-4 w-5/6 bg-zinc-200 dark:bg-zinc-700 rounded" />
            </div>
            <div className="h-3 w-1/3 bg-zinc-100 dark:bg-zinc-800 rounded ml-4" />
            <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800/80 ml-4">
                <div className="h-3 w-12 bg-zinc-100 dark:bg-zinc-800 rounded" />
                <div className="flex items-center gap-1">
                    <div className="w-4 h-4 rounded-full bg-purple-200 dark:bg-purple-900/50" />
                    <div className="w-4 h-4 rounded-full bg-indigo-200 dark:bg-indigo-900/50" />
                </div>
            </div>
        </div>
    );
}

export function SkeletonKanbanColumn({ cards = 3 }: { cards?: number }) {
    return (
        <div className="rounded-2xl border p-3.5 min-h-[420px] bg-zinc-50/70 dark:bg-zinc-900/50 border-zinc-200/80 dark:border-zinc-800/80 space-y-3 animate-pulse">
            <div className="flex items-center justify-between mb-2">
                <div className="h-4 w-28 bg-zinc-200 dark:bg-zinc-700 rounded-md" />
                <div className="h-4 w-6 bg-zinc-200 dark:bg-zinc-700 rounded-full" />
            </div>
            <div className="space-y-2.5">
                {Array.from({ length: cards }).map((_, i) => (
                    <SkeletonKanbanCard key={i} />
                ))}
            </div>
        </div>
    );
}

export function SkeletonKanbanBoard({ columns = 4 }: { columns?: number }) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: columns }).map((_, i) => (
                <SkeletonKanbanColumn key={i} />
            ))}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 5. Project Grid & Card Skeleton
 * ───────────────────────────────────────────────────────────── */
export function SkeletonProjectCard() {
    return (
        <div className="p-4 rounded-xl border border-zinc-100 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-3 animate-pulse">
            <div className="w-9 h-9 bg-zinc-200 dark:bg-zinc-700 rounded-xl" />
            <div className="h-4 w-3/4 bg-zinc-200 dark:bg-zinc-700 rounded" />
            <div className="h-3 w-1/2 bg-zinc-100 dark:bg-zinc-800 rounded" />
            <div className="h-1.5 w-full bg-zinc-200 dark:bg-zinc-700 rounded-full" />
        </div>
    );
}

export function SkeletonProjectGrid({ count = 5 }: { count?: number }) {
    return (
        <div className="card p-5 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-2xl animate-pulse">
            <div className="flex items-center justify-between mb-5">
                <div className="h-6 w-48 bg-zinc-200 dark:bg-zinc-700 rounded-md" />
                <div className="h-4 w-24 bg-zinc-100 dark:bg-zinc-800 rounded" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                {Array.from({ length: count }).map((_, i) => (
                    <SkeletonProjectCard key={i} />
                ))}
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 6. Tables & Data Lists Skeletons
 * ───────────────────────────────────────────────────────────── */
export function SkeletonTableRow({ columns = 5 }: { columns?: number }) {
    return (
        <tr className="animate-pulse border-b border-zinc-100 dark:border-zinc-800">
            {Array.from({ length: columns }).map((_, i) => (
                <td key={i} className="py-3.5 px-4">
                    <div className="h-3.5 bg-zinc-200 dark:bg-zinc-700 rounded" style={{ width: i === 0 ? '75%' : '55%' }} />
                </td>
            ))}
        </tr>
    );
}

export function SkeletonTable({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
    return (
        <div className="card overflow-hidden bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl animate-pulse">
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
                <div className="h-5 w-36 bg-zinc-200 dark:bg-zinc-700 rounded-md" />
                <div className="h-8 w-48 bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-100 dark:border-zinc-800">
                        <tr>
                            {Array.from({ length: columns }).map((_, i) => (
                                <th key={i} className="py-3 px-4">
                                    <div className="h-3 w-16 bg-zinc-200 dark:bg-zinc-700 rounded" />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {Array.from({ length: rows }).map((_, i) => (
                            <SkeletonTableRow key={i} columns={columns} />
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export function SkeletonListItem() {
    return (
        <div className="card p-4 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl flex items-center gap-4 animate-pulse">
            <div className="w-9 h-9 rounded-full bg-zinc-200 dark:bg-zinc-700 shrink-0" />
            <div className="flex-1 space-y-1.5">
                <div className="h-4 w-3/5 bg-zinc-200 dark:bg-zinc-700 rounded" />
                <div className="h-3 w-1/3 bg-zinc-100 dark:bg-zinc-800 rounded" />
            </div>
            <div className="flex items-center gap-2">
                <div className="h-6 w-16 bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
                <div className="w-7 h-7 rounded-full bg-zinc-100 dark:bg-zinc-800" />
            </div>
        </div>
    );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
    return (
        <div className="space-y-2.5">
            {Array.from({ length: count }).map((_, i) => (
                <SkeletonListItem key={i} />
            ))}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 7. Activity Timeline Skeleton
 * ───────────────────────────────────────────────────────────── */
export function SkeletonActivityFeed({ count = 5 }: { count?: number }) {
    return (
        <div className="card p-5 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800/80 rounded-2xl space-y-4 animate-pulse">
            <div className="h-5 w-32 bg-zinc-200 dark:bg-zinc-700 rounded-md mb-2" />
            <div className="space-y-3">
                {Array.from({ length: count }).map((_, i) => (
                    <div key={i} className="flex items-start gap-3 p-2.5 rounded-xl bg-zinc-50/50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
                        <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 shrink-0" />
                        <div className="flex-1 space-y-1.5 min-w-0">
                            <div className="h-3.5 w-4/5 bg-zinc-200 dark:bg-zinc-700 rounded" />
                            <div className="h-2.5 w-1/3 bg-zinc-100 dark:bg-zinc-800 rounded" />
                        </div>
                        <div className="h-3 w-12 bg-zinc-100 dark:bg-zinc-800 rounded shrink-0" />
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 8. Chat & Messaging View Skeleton
 * ───────────────────────────────────────────────────────────── */
export function SkeletonChatMessage({ isRight = false }: { isRight?: boolean }) {
    return (
        <div className={clsx('flex gap-3 items-end animate-pulse', isRight ? 'justify-end' : 'justify-start')}>
            {!isRight && <Skeleton variant="circular" width={32} height={32} />}
            <div className={clsx(
                'p-3.5 rounded-2xl max-w-[70%] space-y-2',
                isRight ? 'bg-indigo-500/20 rounded-br-none' : 'bg-zinc-100 dark:bg-zinc-800 rounded-bl-none'
            )}>
                <div className="h-3.5 bg-zinc-300 dark:bg-zinc-700 rounded w-44" />
                <div className="h-3 bg-zinc-200 dark:bg-zinc-700/60 rounded w-28" />
            </div>
            {isRight && <Skeleton variant="circular" width={32} height={32} />}
        </div>
    );
}

export function SkeletonChatView({ count = 5 }: { count?: number }) {
    return (
        <div className="card h-[500px] flex flex-col justify-between p-4 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl animate-pulse">
            {/* Chat header */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center gap-3">
                    <Skeleton variant="circular" width={40} height={40} />
                    <div className="space-y-1.5">
                        <div className="h-4 w-32 bg-zinc-200 dark:bg-zinc-700 rounded" />
                        <div className="h-3 w-20 bg-zinc-100 dark:bg-zinc-800 rounded" />
                    </div>
                </div>
                <div className="flex gap-2">
                    <Skeleton variant="circular" width={32} height={32} />
                    <Skeleton variant="circular" width={32} height={32} />
                </div>
            </div>

            {/* Chat messages */}
            <div className="flex-1 overflow-hidden py-4 space-y-3.5">
                {Array.from({ length: count }).map((_, i) => (
                    <SkeletonChatMessage key={i} isRight={i % 2 === 1} />
                ))}
            </div>

            {/* Input bar */}
            <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
                <Skeleton variant="rounded" width="100%" height={40} className="rounded-xl" />
                <Skeleton variant="rounded" width={44} height={40} className="rounded-xl" />
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 9. Calendar Grid Skeleton
 * ───────────────────────────────────────────────────────────── */
export function SkeletonCalendarView() {
    return (
        <div className="card p-5 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl space-y-4 animate-pulse">
            {/* Header controls */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="h-6 w-36 bg-zinc-200 dark:bg-zinc-700 rounded-md" />
                    <div className="h-7 w-20 bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
                </div>
                <div className="flex gap-2">
                    <div className="h-8 w-24 bg-zinc-100 dark:bg-zinc-800 rounded-lg" />
                    <div className="h-8 w-28 bg-zinc-200 dark:bg-zinc-700 rounded-lg" />
                </div>
            </div>

            {/* 7 Column Calendar Grid */}
            <div className="grid grid-cols-7 gap-2">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => (
                    <div key={i} className="text-center py-1 font-bold text-xs text-zinc-400">
                        <div className="h-3 w-6 bg-zinc-100 dark:bg-zinc-800 rounded mx-auto" />
                    </div>
                ))}
                {Array.from({ length: 35 }).map((_, j) => (
                    <div
                        key={j}
                        className="h-20 sm:h-24 p-1.5 rounded-xl border border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/50 flex flex-col justify-between"
                    >
                        <div className="h-3 w-4 bg-zinc-200 dark:bg-zinc-700 rounded" />
                        {j % 3 === 0 && (
                            <div className="h-4 w-full bg-indigo-100 dark:bg-indigo-950/60 rounded text-[9px] px-1" />
                        )}
                        {j % 5 === 0 && (
                            <div className="h-4 w-3/4 bg-emerald-100 dark:bg-emerald-950/60 rounded text-[9px] px-1" />
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 10. Document & Editor Skeleton
 * ───────────────────────────────────────────────────────────── */
export function SkeletonDocumentEditor() {
    return (
        <div className="card p-6 sm:p-8 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl space-y-6 animate-pulse max-w-4xl mx-auto">
            {/* Editor Toolbar */}
            <div className="flex items-center justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800">
                <div className="flex items-center gap-2">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                        <Skeleton key={i} variant="rounded" width={28} height={28} className="rounded-md" />
                    ))}
                </div>
                <div className="flex gap-2">
                    <Skeleton variant="rounded" width={72} height={32} className="rounded-lg" />
                    <Skeleton variant="rounded" width={80} height={32} className="rounded-lg" />
                </div>
            </div>

            {/* Document Title & Metadata */}
            <div className="space-y-3">
                <Skeleton variant="text" width="60%" height={32} className="rounded-lg" />
                <div className="flex items-center gap-3">
                    <Skeleton variant="circular" width={24} height={24} />
                    <Skeleton variant="text" width={120} height={12} />
                    <Skeleton variant="text" width={80} height={12} />
                </div>
            </div>

            {/* Content Blocks */}
            <div className="space-y-4 pt-2">
                <SkeletonText lines={4} />
                <Skeleton variant="rounded" width="100%" height={220} className="rounded-xl" />
                <SkeletonText lines={3} />
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 11. Form Skeleton
 * ───────────────────────────────────────────────────────────── */
export function SkeletonForm({ fields = 6 }: { fields?: number }) {
    return (
        <div className="card p-6 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl space-y-5 animate-pulse">
            <div className="space-y-1.5 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                <Skeleton variant="text" width={160} height={20} />
                <Skeleton variant="text" width={260} height={12} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Array.from({ length: fields }).map((_, i) => (
                    <SkeletonInput key={i} />
                ))}
            </div>

            <div className="pt-3 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-3">
                <SkeletonButton size="md" />
                <SkeletonButton size="md" />
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 12. Detail Drawer & Modal Skeleton
 * ───────────────────────────────────────────────────────────── */
export function SkeletonDetailModal() {
    return (
        <div className="card p-6 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl space-y-6 animate-pulse max-w-2xl mx-auto">
            <div className="flex items-start justify-between pb-4 border-b border-zinc-100 dark:border-zinc-800">
                <div className="space-y-2">
                    <Skeleton variant="text" width={220} height={22} />
                    <div className="flex gap-2">
                        <SkeletonBadge width={64} />
                        <SkeletonBadge width={72} />
                    </div>
                </div>
                <Skeleton variant="circular" width={28} height={28} />
            </div>

            <div className="grid grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="p-3 bg-zinc-50 dark:bg-zinc-900 rounded-xl space-y-1.5">
                        <Skeleton variant="text" width={60} height={10} />
                        <Skeleton variant="text" width={110} height={14} />
                    </div>
                ))}
            </div>

            <div className="space-y-2">
                <Skeleton variant="text" width={80} height={12} />
                <SkeletonText lines={3} />
            </div>

            <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800 flex justify-end gap-2">
                <SkeletonButton size="sm" />
                <SkeletonButton size="sm" />
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 13. Media & Creative Grid Skeleton
 * ───────────────────────────────────────────────────────────── */
export function SkeletonMediaGrid({ count = 6 }: { count?: number }) {
    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 animate-pulse">
            {Array.from({ length: count }).map((_, i) => (
                <div key={i} className="card overflow-hidden bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-xl space-y-2.5 p-2.5">
                    <Skeleton variant="rounded" width="100%" height={140} className="rounded-lg" />
                    <div className="px-1 space-y-1">
                        <Skeleton variant="text" width="80%" height={14} />
                        <Skeleton variant="text" width="40%" height={10} />
                    </div>
                </div>
            ))}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 14. Tree / File Explorer Skeleton
 * ───────────────────────────────────────────────────────────── */
export function SkeletonTree({ count = 6 }: { count?: number }) {
    return (
        <div className="card p-4 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl space-y-3 animate-pulse">
            {Array.from({ length: count }).map((_, i) => {
                const indent = (i % 3) * 16;
                return (
                    <div key={i} className="flex items-center gap-2.5" style={{ paddingLeft: `${indent}px` }}>
                        <Skeleton variant="rounded" width={16} height={16} className="rounded" />
                        <Skeleton variant="circular" width={20} height={20} />
                        <Skeleton variant="text" width={100 + (i * 20)} height={12} />
                    </div>
                );
            })}
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 15. Personal Workspace Skeleton
 * ───────────────────────────────────────────────────────────── */
export function SkeletonWorkspace() {
    return (
        <div className="space-y-6 animate-pulse">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-2">
                    <div className="h-7 w-48 bg-zinc-200 dark:bg-zinc-700 rounded-lg" />
                    <div className="h-4 w-72 bg-zinc-100 dark:bg-zinc-800 rounded" />
                </div>
                <div className="h-12 w-64 bg-zinc-100 dark:bg-zinc-800 rounded-2xl border border-zinc-200/60 dark:border-zinc-700/60" />
            </div>

            {/* 4 Metric Cards */}
            <SkeletonMetricGrid count={4} columns={4} />

            {/* Main Content 2-Column */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 p-5 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-zinc-100 dark:border-zinc-800">
                        <div className="h-5 w-36 bg-zinc-200 dark:bg-zinc-700 rounded" />
                        <div className="h-4 w-20 bg-zinc-100 dark:bg-zinc-800 rounded" />
                    </div>
                    {[1, 2, 3, 4].map((j) => (
                        <div key={j} className="p-3.5 rounded-xl border border-zinc-100 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/50 flex items-center justify-between gap-3">
                            <div className="space-y-1.5 flex-1">
                                <div className="h-4 w-2/3 bg-zinc-200 dark:bg-zinc-700 rounded" />
                                <div className="h-3 w-1/3 bg-zinc-100 dark:bg-zinc-800 rounded" />
                            </div>
                            <div className="h-6 w-16 bg-zinc-200 dark:bg-zinc-700 rounded-full" />
                        </div>
                    ))}
                </div>

                <div className="p-5 bg-white dark:bg-zinc-900 rounded-2xl border border-zinc-200/80 dark:border-zinc-800 space-y-4">
                    <div className="h-5 w-32 bg-zinc-200 dark:bg-zinc-700 rounded" />
                    <div className="h-40 bg-zinc-100 dark:bg-zinc-800 rounded-xl" />
                    <div className="space-y-2 pt-2">
                        <div className="h-3 w-full bg-zinc-100 dark:bg-zinc-800 rounded" />
                        <div className="h-3 w-4/5 bg-zinc-100 dark:bg-zinc-800 rounded" />
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 16. Generic Card & Chart Skeletons
 * ───────────────────────────────────────────────────────────── */
export function SkeletonCard() {
    return (
        <div className="card p-4 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl space-y-3 animate-pulse">
            <div className="flex items-center gap-3">
                <Skeleton variant="circular" width={40} height={40} />
                <div className="space-y-2 flex-1">
                    <Skeleton variant="text" width="60%" height={12} />
                    <Skeleton variant="text" width="40%" height={10} />
                </div>
            </div>
            <Skeleton variant="rounded" width="100%" height={100} />
            <div className="flex gap-2">
                <Skeleton variant="rounded" width={60} height={24} />
                <Skeleton variant="rounded" width={60} height={24} />
            </div>
        </div>
    );
}

export function SkeletonChart() {
    return (
        <div className="card p-5 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 rounded-2xl space-y-4 animate-pulse">
            <Skeleton variant="text" width="30%" height={16} />
            <div className="flex items-end gap-2 h-[180px] pt-4">
                {Array.from({ length: 7 }).map((_, i) => (
                    <Skeleton
                        key={i}
                        variant="rounded"
                        width="100%"
                        height={`${Math.floor(Math.random() * 60) + 30}%`}
                    />
                ))}
            </div>
        </div>
    );
}

/* ─────────────────────────────────────────────────────────────
 * 17. Universal & Adaptive Compound Dispatcher
 * ───────────────────────────────────────────────────────────── */
export type SkeletonType =
    | 'financial'
    | 'focus_stream'
    | 'metrics'
    | 'kanban'
    | 'projects'
    | 'table'
    | 'list'
    | 'activity'
    | 'chat'
    | 'calendar'
    | 'editor'
    | 'form'
    | 'detail'
    | 'media'
    | 'tree'
    | 'workspace'
    | 'card'
    | 'chart';

export interface CompoundLayoutConfig {
    header?: boolean | { title?: string; search?: boolean; actions?: number };
    metrics?: number;
    tabs?: string[];
    content?: SkeletonType;
    sidebar?: boolean;
}

export interface UniversalSkeletonProps {
    type?: SkeletonType;
    count?: number;
    columns?: number;
    rows?: number;
    fields?: number;
    layout?: CompoundLayoutConfig;
    className?: string;
}

/**
 * Universal adaptive skeleton component. One single centralized tag for all platform loading states!
 */
export function UniversalSkeleton({
    type = 'card',
    count = 3,
    columns = 4,
    rows = 5,
    fields = 6,
    layout,
    className,
}: UniversalSkeletonProps) {
    // If a compound layout object is provided, compose dynamically
    if (layout) {
        return (
            <div className={clsx('space-y-6 w-full animate-pulse', className)}>
                {layout.header && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-zinc-100 dark:border-zinc-800">
                        <div className="space-y-1.5">
                            <Skeleton variant="text" width={180} height={24} />
                            <Skeleton variant="text" width={280} height={12} />
                        </div>
                        <div className="flex gap-2">
                            <SkeletonButton size="md" />
                            <SkeletonButton size="md" />
                        </div>
                    </div>
                )}

                {layout.metrics && (
                    <SkeletonMetricGrid count={layout.metrics} columns={Math.min(layout.metrics, 4) as any} />
                )}

                {layout.tabs && (
                    <div className="flex gap-2 border-b border-zinc-100 dark:border-zinc-800 pb-2">
                        {layout.tabs.map((_, idx) => (
                            <Skeleton key={idx} variant="rounded" width={80} height={28} className="rounded-lg" />
                        ))}
                    </div>
                )}

                <div className={clsx(layout.sidebar ? 'grid grid-cols-1 lg:grid-cols-4 gap-6' : 'w-full')}>
                    <div className={clsx(layout.sidebar ? 'lg:col-span-3' : 'w-full')}>
                        <UniversalSkeleton type={layout.content || 'table'} count={count} columns={columns} rows={rows} />
                    </div>
                    {layout.sidebar && (
                        <div className="space-y-4">
                            <SkeletonCard />
                            <SkeletonList count={3} />
                        </div>
                    )}
                </div>
            </div>
        );
    }

    switch (type) {
        case 'financial':
            return <SkeletonFinancialTrajectory />;
        case 'focus_stream':
            return <SkeletonFocusStream count={count} />;
        case 'metrics':
            return <SkeletonMetricGrid count={count} columns={columns as any} />;
        case 'kanban':
            return <SkeletonKanbanBoard columns={columns} />;
        case 'projects':
            return <SkeletonProjectGrid count={count} />;
        case 'table':
            return <SkeletonTable rows={rows} columns={columns} />;
        case 'list':
            return <SkeletonList count={count} />;
        case 'activity':
            return <SkeletonActivityFeed count={count} />;
        case 'chat':
            return <SkeletonChatView count={count} />;
        case 'calendar':
            return <SkeletonCalendarView />;
        case 'editor':
            return <SkeletonDocumentEditor />;
        case 'form':
            return <SkeletonForm fields={fields} />;
        case 'detail':
            return <SkeletonDetailModal />;
        case 'media':
            return <SkeletonMediaGrid count={count} />;
        case 'tree':
            return <SkeletonTree count={count} />;
        case 'workspace':
            return <SkeletonWorkspace />;
        case 'chart':
            return <SkeletonChart />;
        case 'card':
        default:
            return <SkeletonCard />;
    }
}

/**
 * Alias for UniversalSkeleton
 */
export const AdaptiveSkeleton = UniversalSkeleton;

/* ─────────────────────────────────────────────────────────────
 * 18. Smart Skeleton Lifecycle Boundary
 * ───────────────────────────────────────────────────────────── */
export interface SkeletonBoundaryProps {
    loading: boolean;
    error?: string | null | boolean;
    empty?: boolean;
    skeleton?: React.ReactNode;
    skeletonType?: SkeletonType;
    emptyMessage?: string;
    emptyIcon?: React.ReactNode;
    emptyAction?: React.ReactNode;
    children: React.ReactNode;
    className?: string;
}

/**
 * Smart boundary wrapper that automatically switches between loading skeleton, error state, empty state, and content.
 */
export function SkeletonBoundary({
    loading,
    error,
    empty,
    skeleton,
    skeletonType = 'table',
    emptyMessage = 'No items found',
    emptyIcon,
    emptyAction,
    children,
    className,
}: SkeletonBoundaryProps) {
    if (loading) {
        return (
            <div className={clsx('w-full transition-opacity duration-300', className)} aria-busy="true">
                {skeleton || <UniversalSkeleton type={skeletonType} />}
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-400 text-sm flex items-center justify-between">
                <span>{typeof error === 'string' ? error : 'Failed to load content. Please try again.'}</span>
            </div>
        );
    }

    if (empty) {
        return (
            <div className="p-8 sm:p-12 text-center rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col items-center justify-center gap-3">
                {emptyIcon}
                <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{emptyMessage}</p>
                {emptyAction}
            </div>
        );
    }

    return <>{children}</>;
}



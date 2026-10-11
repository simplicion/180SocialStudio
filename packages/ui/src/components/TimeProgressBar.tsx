'use client';

/**
 * TimeProgressBar — Shows a depleting time bar for a task.
 * 
 * Props:
 *   createdAt    — When the task was created (ISO string)
 *   dueDate      — The deadline (ISO string)
 *   estimatedHours — Hours estimated (auto-calculated on create)
 *   status       — Task status string
 *   compact      — If true, renders a slimmer inline version
 */

import { useMemo } from 'react';
import clsx from 'clsx';
import { Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { formatDistanceToNow, format, isValid } from 'date-fns';

interface TimeProgressBarProps {
    createdAt?: string;
    dueDate?: string;
    estimatedHours?: number;
    status?: string;
    compact?: boolean;
    completedOnTime?: boolean | null;
}

function getBarColor(pct: number, isOverdue: boolean, isDone: boolean) {
    if (isDone) return 'bg-emerald-500';
    if (isOverdue) return 'bg-rose-500';
    if (pct <= 25) return 'bg-rose-400';
    if (pct <= 50) return 'bg-amber-400';
    return 'bg-emerald-400';
}

export default function TimeProgressBar({
    createdAt, dueDate, estimatedHours, status, compact = false, completedOnTime
}: TimeProgressBarProps) {
    const isDone = status === 'done';

    const computed = useMemo(() => {
        const now = new Date();
        const created = createdAt ? new Date(createdAt) : null;
        const due = dueDate ? new Date(dueDate) : null;

        if (!due || !isValid(due)) return null;

        const totalMs = created && isValid(created)
            ? due.getTime() - created.getTime()
            : (estimatedHours || 8) * 60 * 60 * 1000; // fallback

        const elapsedMs = now.getTime() - (created ? created.getTime() : now.getTime() - totalMs);
        const remainingMs = due.getTime() - now.getTime();
        const isOverdue = remainingMs < 0 && !isDone;

        // Percentage of time remaining (100% = just started, 0% = overdue)
        const pct = isDone ? 100 : Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));

        const remainingLabel = isOverdue
            ? `${formatDistanceToNow(due)} overdue`
            : remainingMs < 60 * 60 * 1000
            ? `${Math.round(remainingMs / 60000)}m left`
            : remainingMs < 24 * 60 * 60 * 1000
            ? `${Math.round(remainingMs / (60 * 60 * 1000))}h left`
            : `${Math.round(remainingMs / (24 * 60 * 60 * 1000))}d left`;

        return { pct, isOverdue, remainingLabel, due };
    }, [createdAt, dueDate, estimatedHours, isDone]);

    if (!computed) return null;

    const { pct, isOverdue, remainingLabel, due } = computed;
    const barColor = getBarColor(pct, isOverdue, isDone);

    if (compact) {
        return (
            <div className="flex items-center gap-2 w-full">
                <div className="flex-1 h-1.5 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                        className={clsx('h-full rounded-full transition-all duration-700', barColor)}
                        style={{ width: `${isDone ? 100 : pct}%` }}
                    />
                </div>
                <span className={clsx('text-[10px] font-bold whitespace-nowrap', isOverdue ? 'text-rose-500' : isDone ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-zinc-500')}>
                    {isDone ? (completedOnTime ? '✓ On time' : '✓ Done') : remainingLabel}
                </span>
            </div>
        );
    }

    return (
        <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                    {isDone ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                    ) : isOverdue ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-500 animate-pulse" />
                    ) : (
                        <Clock className="w-3.5 h-3.5 text-gray-400 dark:text-zinc-500" />
                    )}
                    <span className={clsx('font-semibold', isOverdue ? 'text-rose-600' : isDone ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-600 dark:text-zinc-300')}>
                        {isDone ? (completedOnTime ? '✅ Completed on time (+1 pt)' : '✅ Completed') : remainingLabel}
                    </span>
                </div>
                <span className="text-gray-400 dark:text-zinc-500">Due {format(due, 'MMM d, hh:mm a')}</span>
            </div>
            <div className="w-full h-2 bg-gray-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                <div
                    className={clsx('h-full rounded-full transition-all duration-700', barColor)}
                    style={{ width: `${isDone ? 100 : pct}%` }}
                />
            </div>
            {estimatedHours ? (
                <p className="text-[10px] text-gray-400 dark:text-zinc-500">{estimatedHours}h estimated</p>
            ) : null}
        </div>
    );
}

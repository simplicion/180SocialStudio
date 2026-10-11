'use client';

import React from 'react';
import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@workspace/ui';
import type { CheckItem, CopyLint, RankedPost } from '@/lib/services/platform-team.service';

const tone = (score: number) =>
    score >= 70
        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900'
        : score >= 50
            ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900'
            : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900';

export function ScoreBadge({ score, label }: { score: number; label?: string }) {
    return (
        <span className={`inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-bold tabular-nums ${tone(score)}`}>
            {Math.round(score)}/100{label ? ` · ${label}` : ''}
        </span>
    );
}

export function Panel({ title, description, action, children }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <Card className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
            <CardHeader className="flex flex-row items-start justify-between gap-4 p-4 md:p-6">
                <div>
                    <CardTitle className="text-base font-bold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</CardTitle>
                    {description && <CardDescription className="mt-1 text-sm text-gray-600 dark:text-gray-400">{description}</CardDescription>}
                </div>
                {action}
            </CardHeader>
            <CardContent className="p-4 pt-0 md:p-6 md:pt-0">{children}</CardContent>
        </Card>
    );
}

export function StatTile({ label, value, accent }: { label: string; value: React.ReactNode; accent?: 'good' | 'bad' }) {
    return (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 px-4 py-3">
            <p className={`text-xl font-bold tabular-nums ${accent === 'good' ? 'text-emerald-600 dark:text-emerald-400' : accent === 'bad' ? 'text-red-600 dark:text-red-400' : 'text-zinc-900 dark:text-zinc-100'}`}>{value}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400">{label}</p>
        </div>
    );
}

/** Error with a retry and a second way out; announced to screen readers. */
export function ErrorBox({ message, onRetry, secondary }: { message: string; onRetry?: () => void; secondary?: React.ReactNode }) {
    return (
        <div role="alert" aria-live="polite" className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4">
            <p className="flex items-start gap-2 text-sm text-red-700 dark:text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{message}</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
                {onRetry && <Button variant="outline" className="min-h-11" onClick={onRetry}>Try again</Button>}
                {secondary}
            </div>
        </div>
    );
}

export function EmptyBox({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
    return (
        <div className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 p-6 text-center">
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{title}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-gray-600 dark:text-gray-400">{message}</p>
            {action && <div className="mt-4 flex justify-center">{action}</div>}
        </div>
    );
}

export function Checks({ checks }: { checks: CheckItem[] }) {
    return (
        <ul className="space-y-2">
            {checks.map((c, i) => {
                const ok = c.status === 'PASS' || c.status === 'FULL';
                const warn = c.status === 'WARN' || c.status === 'PARTIAL';
                const Icon = ok ? CheckCircle2 : warn ? AlertCircle : XCircle;
                return (
                    <li key={`${c.check || c.name}-${i}`} className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ok ? 'text-emerald-500' : warn ? 'text-amber-500' : 'text-red-500'}`} />
                        <span>{c.detail || c.feedback}</span>
                    </li>
                );
            })}
        </ul>
    );
}

/** What the feed shows before the fold. */
export function FeedPreview({ lint }: { lint: Pick<CopyLint, 'feedCutout' | 'foldChars' | 'foldLabel' | 'isTruncated'> }) {
    return (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-500">What the feed shows (first {lint.foldChars} characters)</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-100">
                {lint.feedCutout}
                {lint.isTruncated && <span className="text-gray-500"> {lint.foldLabel}</span>}
            </p>
        </div>
    );
}

export function RankedPostRow({ post }: { post: RankedPost }) {
    const m = post.metrics;
    const stats = [
        ['views', m?.views ?? post.views], ['reach', m?.reach], ['likes', m?.likes ?? post.likes], ['comments', m?.comments ?? post.comments], ['shares', m?.shares], ['saves', m?.saves],
    ].filter(([, v]) => typeof v === 'number').map(([k, v]) => `${v} ${k}`);
    const body = (
        <div className={`flex items-start gap-3 rounded-2xl border p-3 transition-all duration-300 ${post.isOutlier ? 'border-emerald-300 dark:border-emerald-900' : 'border-zinc-200 dark:border-zinc-800'} ${post.url ? 'hover:bg-gray-100 dark:hover:bg-gray-800' : ''}`}>
            <span className={`w-16 shrink-0 rounded-lg py-1.5 text-center text-sm font-bold tabular-nums ${post.isOutlier ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}>
                {post.outlierMultiple}x
            </span>
            <div className="min-w-0">
                {post.account && <p className="text-xs font-semibold text-gray-500">@{post.account}</p>}
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{post.hook || 'Untitled'}</p>
                {stats.length > 0 && <p className="mt-1 text-xs text-gray-500">{stats.join(' · ')}</p>}
                {post.formulaName && <p className="text-xs text-gray-600 dark:text-gray-400">Hook shape: {post.formulaName}</p>}
            </div>
        </div>
    );
    return post.url ? <a href={post.url} target="_blank" rel="noopener noreferrer" className="block">{body}</a> : body;
}

export const timeAgo = (iso?: string | null): string => {
    if (!iso) return '';
    const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
    if (mins < 60) return `${mins} min ago`;
    if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
    return `${Math.round(mins / 1440)} d ago`;
};

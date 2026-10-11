'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Button, Input, UniversalSkeleton } from '@workspace/ui';
import {
    PlatformOverview, Radar, apiErrorMessage, isAiNotConfigured, platformTeamService,
} from '@/lib/services/platform-team.service';
import { EmptyBox, ErrorBox, Panel, RankedPostRow, ScoreBadge, StatTile, timeAgo } from './shared';

const BASIS: Record<string, string> = { views: 'views', reach: 'reach', engagements: 'likes, comments, shares and saves' };
const BUCKETS: [string, string][] = [['LEAD', 'Leads'], ['KEYWORD', 'Keyword'], ['QUESTION', 'Questions'], ['SUBSTANCE', 'Discussion'], ['SUPPORT', 'Support'], ['NOISE', 'Noise']];

/** Live state of one platform for a project. Everything shown is stored or read from the platform; nothing sampled. */
export function MonitorPanel({ platform, label, projectId, onCreate }: { platform: string; label: string; projectId: string; onCreate: () => void }) {
    const [data, setData] = useState<PlatformOverview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await platformTeamService.overview(platform, projectId));
        } catch (e) {
            setError(apiErrorMessage(e));
        } finally {
            setLoading(false);
        }
    }, [platform, projectId]);

    useEffect(() => { load(); }, [load]);

    const refreshMetrics = async () => {
        setRefreshing(true);
        try {
            const r = await platformTeamService.refreshMetrics(platform, projectId);
            const failed = r.refresh.failed.length;
            toast[failed && !r.refresh.updated ? 'error' : 'success'](failed ? `${r.refresh.updated} posts updated, ${failed} could not be read: ${r.refresh.failed[0].reason}` : `${r.refresh.updated} posts updated`);
            setData(await platformTeamService.overview(platform, projectId));
        } catch (e) {
            toast.error(apiErrorMessage(e));
        } finally {
            setRefreshing(false);
        }
    };

    if (loading) return <UniversalSkeleton type="metrics" />;
    if (error || !data) {
        return <ErrorBox message={error || 'No data'} onRetry={load} secondary={<Button asChild variant="ghost" className="min-h-11"><Link href="/social-projects">Back to projects</Link></Button>} />;
    }
    const own = data.ownPosts;

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
            <Panel title="Account" description={data.connected ? undefined : `Connect ${label} in the 180 Social Studio app to see followers, reach, your queue and inbox here.`}>
                {data.accounts.length === 0 ? (
                    <EmptyBox title={`No ${label} account connected`} message="Accounts are connected from the Social Studio app, under the project's Accounts tab." action={<Button className="min-h-11" onClick={onCreate}>Draft a {label} post meanwhile</Button>} />
                ) : (
                    <ul className="space-y-2">
                        {data.accounts.map((a) => (
                            <li key={a.id} className="flex items-center justify-between rounded-2xl border border-zinc-200 dark:border-zinc-800 p-3">
                                <div>
                                    <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{a.accountName || a.username}</p>
                                    {a.username && <p className="text-xs text-gray-500">@{a.username}</p>}
                                </div>
                                <span className={`text-xs font-bold ${a.reauthRequired ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{a.reauthRequired ? 'Reconnect needed' : 'Connected'}</span>
                            </li>
                        ))}
                    </ul>
                )}
                {data.metrics.map((m) => (
                    <div key={m.socialAccountId} className="mt-4">
                        <p className="text-xs font-semibold text-gray-500">{m.source === 'live' ? `Live${m.periodDays ? ` · last ${m.periodDays} days` : ''}` : m.source === 'stored' ? 'Saved numbers' : 'Numbers unavailable'}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
                            {([['followersCount', 'Followers'], ['reach', 'Reach'], ['views', 'Views'], ['impressions', 'Impressions'], ['engagements', 'Engagements']] as const)
                                .filter(([k]) => typeof m[k] === 'number')
                                .map(([k, l]) => <StatTile key={k} label={l} value={m[k]} />)}
                        </div>
                        {m.unavailable?.message && <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">{m.unavailable.message}</p>}
                    </div>
                ))}
                {data.metricsError && <p role="alert" className="mt-2 text-xs text-amber-600 dark:text-amber-400">Live metrics could not be loaded: {data.metricsError}</p>}
                <div className="mt-4 grid grid-cols-3 gap-2">
                    <StatTile label="Published, 30 days" value={data.pipeline.published30d} />
                    <StatTile label="Scheduled" value={data.pipeline.scheduledUpcoming} />
                    <StatTile label="Failed" value={data.pipeline.failed30d} accent={data.pipeline.failed30d > 0 ? 'bad' : undefined} />
                </div>
            </Panel>

            <Panel
                title="Your posts, ranked"
                description={own.baseline != null ? `Each post against your median of ${Math.round(own.baseline)} ${BASIS[own.basis]}. 3x or more is an outlier worth repeating.` : undefined}
                action={data.connected ? <Button variant="outline" className="min-h-11" disabled={refreshing} onClick={refreshMetrics}>{refreshing ? `Reading from ${label}…` : 'Refresh numbers'}</Button> : undefined}
            >
                {refreshing ? <UniversalSkeleton type="activity" /> : own.top.length === 0 ? (
                    <EmptyBox
                        title="No ranking yet"
                        message={!data.connected ? `Connect ${label} to rank your posts by how far each one beat your usual numbers.`
                            : own.published === 0 ? `Nothing published to ${label} in the last 90 days.`
                                : own.measured === 0 ? `${own.published} published posts have no numbers yet. Refresh to read them from ${label}.`
                                    : `${own.needsMore} more measured posts are needed before a ranking means anything (${own.measured} so far).`}
                        action={<Button className="min-h-11" onClick={onCreate}>Draft a {label} post</Button>}
                    />
                ) : (
                    <div className="space-y-2">
                        {own.top.map((p) => <RankedPostRow key={p.postId || p.hook} post={p} />)}
                        {own.lastFetchedAt && <p className="text-xs text-gray-500">Updated {timeAgo(own.lastFetchedAt)}</p>}
                    </div>
                )}
            </Panel>

            <RadarPanel platform={platform} label={label} projectId={projectId} />

            <Panel title="Waiting to go out" action={data.queueCraftScoreAvg != null ? <ScoreBadge score={data.queueCraftScoreAvg} label="avg craft" /> : undefined}>
                {data.queue.length === 0 ? (
                    <EmptyBox title={`Nothing queued for ${label}`} message="Drafts, approved and scheduled posts appear here with a craft score." action={<Button className="min-h-11" onClick={onCreate}>Draft a {label} post</Button>} />
                ) : (
                    <ul className="space-y-2">
                        {data.queue.map((q) => (
                            <li key={q.postId} className={`rounded-2xl border p-3 ${q.problems.length ? 'border-red-200 dark:border-red-900' : 'border-zinc-200 dark:border-zinc-800'}`}>
                                <div className="flex items-center justify-between gap-3">
                                    <p className="truncate text-sm font-bold text-zinc-900 dark:text-zinc-100">{q.title || 'Untitled post'}</p>
                                    {q.craftScore != null && <ScoreBadge score={q.craftScore} />}
                                </div>
                                <p className="text-xs text-gray-500">{q.status}{q.scheduledFor ? ` · ${new Date(q.scheduledFor).toLocaleString()}` : ''}</p>
                                {q.problems.map((p) => <p key={p} className="mt-1 text-xs text-red-600 dark:text-red-400">{p}</p>)}
                                {q.warnings.slice(0, 2).map((w) => <p key={w} className="mt-1 text-xs text-gray-600 dark:text-gray-400">{w}</p>)}
                            </li>
                        ))}
                    </ul>
                )}
            </Panel>

            <InboxPanel data={data} platform={platform} projectId={projectId} />

            <Panel title={`What ${label} rewards`}>
                <div className="flex flex-wrap gap-2">
                    {data.rewardedSignals.map((s) => <span key={s} className="rounded-lg bg-zinc-100 px-2.5 py-1 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{s}</span>)}
                </div>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-600 dark:text-gray-400">
                    {data.playbook.map((r) => <li key={r}>{r}</li>)}
                </ul>
            </Panel>
        </div>
    );
}

function InboxPanel({ data, platform, projectId }: { data: PlatformOverview; platform: string; projectId: string }) {
    const [drafts, setDrafts] = useState<Record<string, { loading?: boolean; error?: string; ai?: boolean; suggestions?: { tone: string; text: string }[]; note?: string }>>({});

    const draft = async (conversationId: string) => {
        setDrafts((d) => ({ ...d, [conversationId]: { loading: true } }));
        try {
            const r = await platformTeamService.draftReplies(platform, projectId, conversationId);
            setDrafts((d) => ({ ...d, [conversationId]: { suggestions: r.suggestions, note: r.suggestions.length ? undefined : r.nextStep } }));
        } catch (e) {
            setDrafts((d) => ({ ...d, [conversationId]: { error: apiErrorMessage(e), ai: isAiNotConfigured(e) } }));
        }
    };

    return (
        <Panel title="Inbox triage" description={data.inbox.sampled ? `${data.inbox.unread} unread. Replies are drafts: send them from the Social Studio inbox.` : undefined}>
            {data.inbox.sampled === 0 ? (
                <EmptyBox title="No messages yet" message="New DMs and comments are sorted into leads, questions and noise here." />
            ) : (
                <>
                    <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
                        {BUCKETS.map(([k, l]) => <StatTile key={k} label={l} value={data.inbox.bucketCounts[k] || 0} accent={k === 'LEAD' && data.inbox.bucketCounts[k] ? 'good' : undefined} />)}
                    </div>
                    <ul className="mt-3 space-y-2">
                        {data.inbox.priority.map((c) => {
                            const d = drafts[c.conversationId];
                            return (
                                <li key={c.conversationId} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-3">
                                    <p className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{c.bucket} · @{c.author}</p>
                                    <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">{c.text}</p>
                                    <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{c.nextStep}</p>
                                    {!d?.suggestions && !d?.note && (
                                        <Button variant="outline" className="mt-2 min-h-11" disabled={d?.loading} onClick={() => draft(c.conversationId)}>{d?.loading ? 'Drafting…' : 'Draft reply'}</Button>
                                    )}
                                    {d?.error && <div className="mt-2"><ErrorBox message={d.error} onRetry={() => draft(c.conversationId)} secondary={d.ai ? <Button asChild variant="ghost" className="min-h-11"><Link href="/settings">Check AI settings</Link></Button> : undefined} /></div>}
                                    {d?.note && <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">{d.note}</p>}
                                    {d?.suggestions?.map((s) => (
                                        <div key={s.text} className="mt-2 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-950">
                                            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">{s.tone}</p>
                                            <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">{s.text}</p>
                                            <Button variant="ghost" className="mt-1 min-h-11" onClick={() => navigator.clipboard.writeText(s.text).then(() => toast.success('Reply copied'))}>Copy</Button>
                                        </div>
                                    ))}
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </Panel>
    );
}

function RadarPanel({ platform, label, projectId }: { platform: string; label: string; projectId: string }) {
    const [radar, setRadar] = useState<Radar | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [handle, setHandle] = useState('');

    const run = useCallback(async (fn: () => Promise<Radar>) => {
        setBusy(true);
        setError(null);
        try {
            setRadar(await fn());
        } catch (e) {
            setError(apiErrorMessage(e));
        } finally {
            setBusy(false);
        }
    }, []);

    useEffect(() => { setRadar(null); run(() => platformTeamService.radar(platform, projectId)); }, [platform, projectId, run]);

    const add = (e: React.FormEvent) => {
        e.preventDefault();
        if (!handle.trim() || !radar) return;
        run(async () => { const r = await platformTeamService.setRadarHandles(platform, projectId, [...radar.handles, handle.trim()]); setHandle(''); return r; });
    };

    return (
        <Panel title="Accounts you watch" description={radar?.supported ? `Read through ${label}'s official API with your connected account. Each post is compared with that account's own median.` : undefined}>
            {!radar && busy && <UniversalSkeleton type="activity" />}
            {error && <div className="mb-3"><ErrorBox message={error} onRetry={() => run(() => platformTeamService.radar(platform, projectId))} secondary={<Button asChild variant="ghost" className="min-h-11"><Link href="/social-projects">Back to projects</Link></Button>} /></div>}
            {radar && !radar.supported && (
                <EmptyBox title="No automatic scan here" message={`${label} gives apps no way to read other accounts' posts. Use the Check tab to score a post you paste in.`} />
            )}
            {radar?.supported && (
                <>
                    <div className="flex flex-wrap gap-2">
                        {radar.handles.map((h) => (
                            <Button key={h} type="button" variant="secondary" className="min-h-11" disabled={busy} title="Stop watching" onClick={() => run(() => platformTeamService.setRadarHandles(platform, projectId, radar.handles.filter((x) => x !== h)))}>
                                @{h} <span aria-hidden className="ml-1">×</span>
                            </Button>
                        ))}
                    </div>
                    <form onSubmit={add} className="mt-3 flex gap-2">
                        <Input className="h-11" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="@handle" aria-label="Handle to watch" disabled={busy} />
                        <Button type="submit" variant="outline" className="min-h-11" disabled={busy || !handle.trim()}>Add</Button>
                        {radar.handles.length > 0 && <Button type="button" className="min-h-11" disabled={busy} onClick={() => run(() => platformTeamService.scanRadar(platform, projectId))}>{busy ? 'Reading…' : radar.scan ? 'Scan again' : 'Scan'}</Button>}
                    </form>
                    {radar.handles.length === 0 && <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">Add up to {radar.maxHandles ?? 10} accounts in your niche to see which of their posts beat their own average.</p>}
                    {radar.scan && (
                        <div className="mt-4 space-y-2">
                            <p className="text-xs text-gray-500">Scanned {timeAgo(radar.scan.fetchedAt)}</p>
                            {radar.scan.accounts.filter((a) => a.error).map((a) => <p key={a.handle} role="alert" className="text-xs text-amber-600 dark:text-amber-400">@{a.handle}: {a.error}</p>)}
                            {radar.scan.top.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-400">No posts could be ranked yet.</p> : radar.scan.top.slice(0, 8).map((p) => <RankedPostRow key={`${p.account}-${p.url || p.hook}`} post={p} />)}
                        </div>
                    )}
                </>
            )}
        </Panel>
    );
}

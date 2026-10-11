'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Button, Input, Textarea, UniversalSkeleton } from '@workspace/ui';
import { CopyLint, HookEvaluation, PlatformDraft, apiErrorMessage, isAiNotConfigured, platformTeamService } from '@/lib/services/platform-team.service';
import { Checks, ErrorBox, FeedPreview, Panel, ScoreBadge } from './shared';

const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => toast.success(`${what} copied`));

function useRun<T>() {
    const [state, setState] = useState<{ loading: boolean; error?: string; ai?: boolean; data?: T }>({ loading: false });
    const run = async (fn: () => Promise<T>) => {
        setState((s) => ({ ...s, loading: true, error: undefined }));
        try {
            setState({ loading: false, data: await fn() });
        } catch (e) {
            setState({ loading: false, error: apiErrorMessage(e), ai: isAiNotConfigured(e) });
        }
    };
    return { ...state, run };
}

const Label = ({ children }: { children: React.ReactNode }) => <p className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-gray-500">{children}</p>;

/** AI draft of a native post for one platform, scored with the same rules as the Check tab. */
export function CreatePanel({ platform, label, projectId, carousel }: { platform: string; label: string; projectId: string; carousel: boolean }) {
    const [idea, setIdea] = useState('');
    const [format, setFormat] = useState<'video' | 'carousel' | 'text'>('video');
    const [keywords, setKeywords] = useState('');
    const draft = useRun<PlatformDraft>();
    const formats: ['video' | 'carousel' | 'text', string][] = [['video', 'Video'], ...(carousel ? [['carousel', 'Carousel'] as ['carousel', string]] : []), ['text', 'Text post']];

    const submit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (idea.trim().length < 8) return void toast.error('Describe the idea in a sentence first.');
        draft.run(() => platformTeamService.draft(platform, {
            idea: idea.trim(), format: format === 'carousel' && !carousel ? 'video' : format, projectId,
            keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
        }));
    };
    const d = draft.data;

    return (
        <Panel title={`Draft a ${label} post`} description={`Written to ${label}'s rules in the project's brand voice, then scored. Facts come only from your idea and the brand profile.`}>
            <form onSubmit={submit} className="space-y-3">
                <Textarea value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={4000} placeholder="What do you want to say, and to whom?" aria-label="Your idea" />
                <div className="flex flex-wrap gap-2">
                    {formats.map(([id, name]) => (
                        <Button key={id} type="button" variant={format === id ? 'default' : 'outline'} className="min-h-11" onClick={() => setFormat(id)}>{name}</Button>
                    ))}
                </div>
                <Input className="h-11" value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Search keywords, comma separated (optional)" aria-label="Search keywords" />
                <Button type="submit" className="min-h-11" disabled={draft.loading}>{draft.loading ? 'Writing…' : 'Write it'}</Button>
            </form>

            {draft.loading && <div className="mt-4"><UniversalSkeleton type="detail" /></div>}
            {draft.error && (
                <div className="mt-4">
                    <ErrorBox message={draft.error} onRetry={() => submit()} secondary={<Button asChild variant="ghost" className="min-h-11"><Link href={draft.ai ? '/settings' : '/social-projects'}>{draft.ai ? 'Check AI settings' : 'Back to projects'}</Link></Button>} />
                </div>
            )}
            {d && !draft.loading && (
                <div>
                    {d.unverifiedFigures.length > 0 && (
                        <p role="alert" className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                            Check these figures before posting, they are not in your idea or brand profile: {d.unverifiedFigures.join(', ')}
                        </p>
                    )}
                    <Label>Hooks, best first</Label>
                    <HookList hooks={d.hooks} />
                    {d.onScreenHook && (<><Label>On-screen hook</Label><p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{d.onScreenHook}</p></>)}
                    {d.title && (<><Label>Title</Label><p className="mb-2 text-sm font-bold text-zinc-900 dark:text-zinc-100">{d.title}</p>{d.titleLint && <Checks checks={d.titleLint.checks} />}</>)}
                    {d.script && (
                        <>
                            <Label>Script · {Math.round(d.script.totalSeconds)}s at {d.script.wpm} wpm</Label>
                            <ol className="space-y-2">
                                {d.script.beats.map((b) => (
                                    <li key={b.timecode} className="grid grid-cols-[4rem_1fr] gap-2 text-sm">
                                        <span className="font-bold tabular-nums text-indigo-600 dark:text-indigo-400">{b.timecode}</span>
                                        <span className="text-zinc-900 dark:text-zinc-100">{b.spokenWords}{b.flags.map((f) => <span key={f} className="block text-xs text-amber-600 dark:text-amber-400">{f}</span>)}</span>
                                    </li>
                                ))}
                            </ol>
                            <Button variant="outline" className="mt-2 min-h-11" onClick={() => copy(d.script!.teleprompterText, 'Script')}>Copy script</Button>
                        </>
                    )}
                    {d.slides.length > 0 && (
                        <>
                            <Label>Slides</Label>
                            <ol className="space-y-2">
                                {d.slides.map((s, i) => (
                                    <li key={`${i}-${s.headline}`} className="text-sm"><span className="font-bold text-zinc-900 dark:text-zinc-100">{i + 2}. {s.headline}</span>{s.body && <span className="block text-gray-600 dark:text-gray-400">{s.body}</span>}</li>
                                ))}
                            </ol>
                        </>
                    )}
                    <Label>Caption</Label>
                    <FeedPreview lint={d.copyLint} />
                    <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-100">{d.caption}</p>
                    {d.hashtags.length > 0 && <p className="mt-2 text-sm text-indigo-600 dark:text-indigo-400">{d.hashtags.join(' ')}</p>}
                    <Button variant="outline" className="mt-2 min-h-11" onClick={() => copy(d.hashtags.length ? `${d.caption}\n\n${d.hashtags.join(' ')}` : d.caption, 'Caption')}>Copy caption</Button>
                    {d.thread && d.thread.length > 1 && (<><Label>As a thread ({d.thread.length} posts)</Label><ol className="space-y-2">{d.thread.map((t) => <li key={t} className="whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-100">{t}</li>)}</ol></>)}
                    <Label>Checks</Label>
                    <div className="mb-3 flex flex-wrap gap-2"><ScoreBadge score={d.copyLint.score} label="copy" /><ScoreBadge score={d.voice.overallScore} label="human voice" /></div>
                    <Checks checks={d.copyLint.checks.filter((c) => c.status !== 'PASS')} />
                </div>
            )}
        </Panel>
    );
}

function HookList({ hooks }: { hooks: HookEvaluation[] }) {
    return (
        <ul className="space-y-3">
            {hooks.map((h) => (
                <li key={h.hook} className="flex items-start gap-3">
                    <ScoreBadge score={h.totalScore} label={h.grade?.toLowerCase()} />
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{h.hook}</p>
                        {(h.dealbreaker || h.formulaName) && <p className="text-xs text-gray-500">{h.dealbreaker || `Shape: ${h.formulaName}`}</p>}
                        {h.recommendations?.map((r) => <p key={r} className="text-xs text-gray-600 dark:text-gray-400">{r}</p>)}
                    </div>
                </li>
            ))}
        </ul>
    );
}

/** Rule-based checks: the same input always gives the same score. No AI. */
export function CheckPanel({ platform, label }: { platform: string; label: string }) {
    const [hook, setHook] = useState('');
    const [spoken, setSpoken] = useState(true);
    const [caption, setCaption] = useState('');
    const [title, setTitle] = useState('');
    const hooks = useRun<{ ranked: HookEvaluation[] }>();
    const lint = useRun<CopyLint>();
    const back = <Button asChild variant="ghost" className="min-h-11"><Link href="/social-projects">Back to projects</Link></Button>;

    const scoreHooks = (e?: React.FormEvent) => {
        e?.preventDefault();
        const list = hook.split('\n').map((l) => l.trim()).filter(Boolean);
        if (!list.length) return void toast.error('Type a hook first.');
        hooks.run(() => platformTeamService.scoreHooks(platform, list, spoken));
    };
    const lintCopy = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!caption.trim()) return void toast.error('Paste the caption first.');
        lint.run(() => platformTeamService.lintCopy(platform, caption, title.trim() || undefined));
    };
    const l = lint.data;

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-6">
            <Panel title="Hook score" description="Length, specifics, stakes, front-loading and who it speaks to. One hook per line to compare.">
                <form onSubmit={scoreHooks} className="space-y-3">
                    <Textarea value={hook} onChange={(e) => setHook(e.target.value)} placeholder="Hook or opening line" aria-label="Hook or opening line" />
                    <label className="flex min-h-11 items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                        <input type="checkbox" className="h-4 w-4" checked={spoken} onChange={(e) => setSpoken(e.target.checked)} />
                        Spoken on camera (must be sayable in under 3 seconds)
                    </label>
                    <Button type="submit" className="min-h-11" disabled={hooks.loading}>{hooks.loading ? 'Scoring…' : 'Score'}</Button>
                </form>
                {hooks.loading && <div className="mt-4"><UniversalSkeleton type="activity" /></div>}
                {hooks.error && <div className="mt-4"><ErrorBox message={hooks.error} onRetry={() => scoreHooks()} secondary={back} /></div>}
                {hooks.data && !hooks.loading && <div className="mt-4"><HookList hooks={hooks.data.ranked} /></div>}
            </Panel>

            <Panel title={`${label} caption check`} description={`What shows before the fold, length, hashtags, links and the ask, by ${label}'s rules.`}>
                <form onSubmit={lintCopy} className="space-y-3">
                    {platform === 'youtube' && <Input className="h-11" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Video title" aria-label="Video title" />}
                    <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={platform === 'youtube' ? 'Description' : 'Caption or post'} aria-label="Caption" />
                    <Button type="submit" className="min-h-11" disabled={lint.loading}>{lint.loading ? 'Checking…' : 'Check'}</Button>
                </form>
                {lint.loading && <div className="mt-4"><UniversalSkeleton type="activity" /></div>}
                {lint.error && <div className="mt-4"><ErrorBox message={lint.error} onRetry={() => lintCopy()} secondary={back} /></div>}
                {l && !lint.loading && (
                    <div className="mt-4 space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                            <ScoreBadge score={l.score} />
                            <span className="text-xs text-gray-500">{l.weightedLength}/{l.maxChars} characters · {l.hashtags.length}/{l.hashtagMax} hashtags</span>
                        </div>
                        <FeedPreview lint={l} />
                        {l.titleLint && <Checks checks={l.titleLint.checks} />}
                        <Checks checks={l.checks} />
                        {l.thread && l.thread.length > 1 && (
                            <div>
                                <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Split into {l.thread.length} posts</p>
                                <ol className="mt-2 space-y-2">{l.thread.map((t) => <li key={t} className="whitespace-pre-wrap text-sm text-zinc-900 dark:text-zinc-100">{t}</li>)}</ol>
                                <Button variant="outline" className="mt-2 min-h-11" onClick={() => copy(l.thread!.join('\n\n'), 'Thread')}>Copy thread</Button>
                            </div>
                        )}
                    </div>
                )}
            </Panel>
        </div>
    );
}

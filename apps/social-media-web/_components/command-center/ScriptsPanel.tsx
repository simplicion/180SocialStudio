'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Button, ConfirmModal, UniversalSkeleton } from '@workspace/ui';
import { ProductionScript, TimedBeat, apiErrorMessage, isAiNotConfigured, platformTeamService } from '@/lib/services/platform-team.service';
import { EmptyBox, ErrorBox, Panel, ScoreBadge, StatTile } from './shared';

const ROLE: Record<string, string> = { hook: 'Hook', body: 'Beat', loop: 'Loop back', cta: 'Call to action' };

interface Piece {
    id?: string;
    _id?: string;
    headline?: string;
    dateScheduled?: string;
    platform?: string;
    format?: string;
    hasScript?: boolean;
    script?: { hook?: string; body?: { beat: string; retentionDevice?: string }[]; retentionLoop?: string; cta?: string } | null;
    spokenHook?: string;
    onScreenHook?: string;
    shotNotes?: string[];
    hookScore?: number | null;
    humanScore?: number | null;
    craft?: { score: number; blocking: string[]; advice: string[] } | null;
    timedBeats?: TimedBeat[];
    productionScript?: ProductionScript | null;
}

const pieceId = (p: Piece) => String(p.id || p._id || '');

/** Lines of the stored script, for pieces saved before the server timed them. Words only; nothing is added. */
function scriptLines(p: Piece): TimedBeat[] {
    if (p.timedBeats?.length) return p.timedBeats;
    const s = p.script;
    if (!s) return [];
    const parts: [string, string | undefined, string | undefined][] = [
        ['hook', s.hook || p.spokenHook, undefined], ...(s.body || []).map((b) => ['body', b.beat, b.retentionDevice] as [string, string, string | undefined]),
        ['loop', s.retentionLoop, undefined], ['cta', s.cta, undefined],
    ];
    return parts.filter(([, t]) => t && t.trim()).map(([role, text, device]) => ({ timecode: '', durationSec: 0, spokenWords: text!, role, retentionDevice: device, flags: [] }));
}

/** Video pieces of the project's calendars with their full script and the on-demand shooting script. */
export function ScriptsPanel({ projectId }: { projectId: string }) {
    const [pieces, setPieces] = useState<Piece[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [confirmRegenerate, setConfirmRegenerate] = useState(false);
    const [shooting, setShooting] = useState<Record<string, { loading?: boolean; error?: string; ai?: boolean; script?: ProductionScript }>>({});

    const load = useCallback(async () => {
        setPieces(null);
        setError(null);
        try {
            const calendars = await platformTeamService.calendars(projectId);
            const all: Piece[] = [];
            // Newest calendars first; three is enough to cover what is being filmed now.
            for (const c of calendars.slice(0, 3)) all.push(...(await platformTeamService.pieces(String(c.id || c._id))));
            const video = all.filter((p) => p.format === 'reel' && scriptLines(p).length > 0);
            setPieces(video);
            setSelected((cur) => cur ?? (video[0] ? pieceId(video[0]) : null));
        } catch (e) {
            setError(apiErrorMessage(e));
        }
    }, [projectId]);

    useEffect(() => { load(); }, [load]);

    const piece = useMemo(() => pieces?.find((p) => pieceId(p) === selected) || null, [pieces, selected]);
    const lines = piece ? scriptLines(piece) : [];
    const shot = piece ? shooting[pieceId(piece)] : undefined;
    const production = shot?.script || piece?.productionScript || null;

    const generate = async (force: boolean) => {
        if (!piece) return;
        const id = pieceId(piece);
        setShooting((s) => ({ ...s, [id]: { loading: true, script: s[id]?.script } }));
        try {
            const script = await platformTeamService.shootingScript(projectId, id, force);
            setShooting((s) => ({ ...s, [id]: { script } }));
        } catch (e) {
            setShooting((s) => ({ ...s, [id]: { error: apiErrorMessage(e), ai: isAiNotConfigured(e), script: s[id]?.script } }));
        }
    };

    if (error) return <ErrorBox message={error} onRetry={load} secondary={<Button asChild variant="ghost" className="min-h-11"><Link href="/social-projects">Back to projects</Link></Button>} />;
    if (!pieces) return <UniversalSkeleton type="detail" />;
    if (pieces.length === 0) {
        return <EmptyBox title="No video scripts yet" message="Generate a content calendar in the Social Studio app. Its video pieces appear here with their full script and shot list." action={<Button asChild className="min-h-11"><Link href="/social-projects">Back to projects</Link></Button>} />;
    }

    return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_1fr] lg:gap-6">
            <Panel title="Video pieces">
                <ul className="max-h-[32rem] space-y-2 overflow-y-auto">
                    {pieces.map((p) => (
                        <li key={pieceId(p)}>
                            <Button variant={pieceId(p) === selected ? 'secondary' : 'ghost'} className="h-auto min-h-11 w-full justify-start whitespace-normal py-2 text-left" onClick={() => setSelected(pieceId(p))}>
                                <span>
                                    <span className="block text-sm font-semibold">{p.headline || 'Untitled'}</span>
                                    <span className="block text-xs text-gray-500">{p.dateScheduled ? new Date(p.dateScheduled).toLocaleDateString() : ''}{p.platform ? ` · ${p.platform}` : ''}</span>
                                </span>
                            </Button>
                        </li>
                    ))}
                </ul>
            </Panel>

            {piece && (
                <div className="space-y-4 lg:space-y-6">
                    <Panel title={piece.headline || 'Script'} action={<Button variant="outline" className="min-h-11" onClick={() => navigator.clipboard.writeText(lines.map((l) => l.spokenWords).join('\n\n')).then(() => toast.success('Script copied'))}>Copy script</Button>}>
                        <div className="flex flex-wrap gap-2">
                            {typeof piece.hookScore === 'number' && <ScoreBadge score={piece.hookScore} label="hook" />}
                            {typeof piece.humanScore === 'number' && <ScoreBadge score={piece.humanScore} label="human voice" />}
                            {piece.craft && <ScoreBadge score={piece.craft.score} label="craft" />}
                        </div>
                        {piece.craft?.blocking?.length ? (
                            <div role="alert" className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
                                <p className="text-xs font-bold text-red-700 dark:text-red-300">Fix before posting</p>
                                <ul className="mt-1 list-disc pl-5 text-sm text-red-700 dark:text-red-300">{piece.craft.blocking.map((b) => <li key={b}>{b}</li>)}</ul>
                            </div>
                        ) : null}
                        {piece.onScreenHook && <p className="mt-3 text-sm text-gray-600 dark:text-gray-400">On-screen hook: <span className="font-bold text-zinc-900 dark:text-zinc-100">{piece.onScreenHook}</span></p>}
                        <ol className="mt-4 space-y-3">
                            {lines.map((l, i) => (
                                <li key={`${i}-${l.spokenWords}`} className={`rounded-2xl border p-3 ${l.flags.length ? 'border-amber-300 dark:border-amber-900' : 'border-zinc-200 dark:border-zinc-800'}`}>
                                    <p className="flex items-center gap-2 text-xs font-bold text-gray-500">
                                        {l.timecode && <span className="tabular-nums text-indigo-600 dark:text-indigo-400">{l.timecode}</span>}
                                        <span>{ROLE[l.role] || 'Beat'}</span>
                                        {l.durationSec > 0 && <span className="ml-auto tabular-nums">{l.durationSec.toFixed(1)}s</span>}
                                    </p>
                                    <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">{l.spokenWords}</p>
                                    {l.retentionDevice && <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{l.retentionDevice}</p>}
                                    {l.flags.map((f) => <p key={f} className="mt-1 text-xs text-amber-600 dark:text-amber-400">{f}</p>)}
                                </li>
                            ))}
                        </ol>
                        {piece.craft?.advice?.length ? <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-gray-600 dark:text-gray-400">{piece.craft.advice.map((a) => <li key={a}>{a}</li>)}</ul> : null}
                    </Panel>

                    <Panel
                        title="Shooting script"
                        description="Scene by scene: shot, framing, action, B-roll and edit cue. The spoken words stay exactly as written."
                        action={production && !shot?.loading ? <Button variant="outline" className="min-h-11" onClick={() => setConfirmRegenerate(true)}>Regenerate</Button> : undefined}
                    >
                        {shot?.loading && <UniversalSkeleton type="detail" />}
                        {shot?.error && <ErrorBox message={shot.error} onRetry={() => generate(!!production)} secondary={<Button asChild variant="ghost" className="min-h-11"><Link href={shot.ai ? '/settings' : '/social-projects'}>{shot.ai ? 'Check AI settings' : 'Back to projects'}</Link></Button>} />}
                        {!production && !shot?.loading && !shot?.error && (
                            <EmptyBox title="Turn this script into a shot list" message="One AI call plans the visuals for every line and a pre-shoot checklist." action={<Button className="min-h-11" onClick={() => generate(false)}>Generate shooting script</Button>} />
                        )}
                        {production && !shot?.loading && (
                            <div>
                                {production.logline && <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{production.logline}</p>}
                                <div className="mt-3 grid grid-cols-3 gap-2">
                                    <StatTile label="Runtime" value={`${Math.round(production.totalSeconds)}s`} />
                                    <StatTile label="Scenes" value={production.scenes.length} />
                                    <StatTile label="Frame" value={<span className="text-sm">{production.aspect}</span>} />
                                </div>
                                {production.flags.length > 0 && <ul role="alert" className="mt-3 list-disc pl-5 text-xs text-amber-600 dark:text-amber-400">{production.flags.map((f) => <li key={f}>{f}</li>)}</ul>}
                                <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
                                    {([['Location', production.setup.location], ['Lighting', production.setup.lighting], ['Wardrobe', production.setup.wardrobe], ['Props', production.setup.props.join(', ')], ['Captions', production.captionStyle], ['Music', production.musicMood]] as const)
                                        .filter(([, v]) => v)
                                        .map(([k, v]) => <div key={k}><dt className="text-xs font-bold text-gray-500">{k}</dt><dd className="text-zinc-900 dark:text-zinc-100">{v}</dd></div>)}
                                </dl>
                                <ol className="mt-4 space-y-3">
                                    {production.scenes.map((s) => (
                                        <li key={s.index} className={`rounded-2xl border p-3 ${s.flags.length ? 'border-amber-300 dark:border-amber-900' : 'border-zinc-200 dark:border-zinc-800'}`}>
                                            <p className="flex items-center gap-2 text-xs font-bold text-gray-500">
                                                <span>{s.index}</span>
                                                <span className="tabular-nums text-indigo-600 dark:text-indigo-400">{s.timecode}</span>
                                                <span>{s.purpose} · {s.shot.replace(/_/g, ' ')}</span>
                                                <span className="ml-auto tabular-nums">{s.durationSec.toFixed(1)}s</span>
                                            </p>
                                            <p className="mt-1 text-sm text-zinc-900 dark:text-zinc-100">{s.spokenLine || <em className="text-gray-500">No speech</em>}</p>
                                            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-gray-600 dark:text-gray-400 md:grid-cols-2">
                                                {([['On screen', s.onScreenText], ['Framing', s.framing], ['Action', s.action], ['B-roll', s.bRoll], ['Edit', s.editCue], ['Audio', s.audioCue], ['Delivery', s.delivery]] as const)
                                                    .filter(([, v]) => v)
                                                    .map(([k, v]) => <div key={k}><dt className="inline font-bold">{k}: </dt><dd className="inline">{v}</dd></div>)}
                                            </dl>
                                            {s.flags.map((f) => <p key={f} className="mt-1 text-xs text-amber-600 dark:text-amber-400">{f}</p>)}
                                        </li>
                                    ))}
                                </ol>
                                {production.checklist.length > 0 && (
                                    <>
                                        <p className="mt-4 text-xs font-bold uppercase tracking-wide text-gray-500">Before you record</p>
                                        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600 dark:text-gray-400">{production.checklist.map((c) => <li key={c}>{c}</li>)}</ul>
                                    </>
                                )}
                            </div>
                        )}
                    </Panel>
                </div>
            )}
            <ConfirmModal
                isOpen={confirmRegenerate}
                title="Regenerate the shooting script?"
                message="The current scenes will be replaced. The spoken script does not change."
                confirmText="Regenerate"
                onConfirm={() => { setConfirmRegenerate(false); generate(true); }}
                onCancel={() => setConfirmRegenerate(false)}
                onClose={() => setConfirmRegenerate(false)}
            />
        </div>
    );
}

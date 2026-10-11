'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button, UniversalSkeleton } from '@workspace/ui';
import { COMMAND_PLATFORMS } from '@/lib/services/platform-team.service';
import { socialProjectService } from '@/lib/services/social-project.service';
import { MonitorPanel } from '../../../_components/command-center/MonitorPanel';
import { CheckPanel, CreatePanel } from '../../../_components/command-center/CreateCheckPanels';
import { ScriptsPanel } from '../../../_components/command-center/ScriptsPanel';
import { ErrorBox } from '../../../_components/command-center/shared';

const TABS = [['monitor', 'Monitor'], ['create', 'Create'], ['check', 'Check'], ['scripts', 'Scripts']] as const;
type Tab = (typeof TABS)[number][0];

/** Command Center for one social project: a growth team per platform plus the video scripts of its calendars. */
export default function CommandCenterPage() {
    // useSearchParams needs a Suspense boundary so the route can still be prerendered.
    return (
        <Suspense fallback={<div className="mx-auto max-w-7xl p-4 md:p-8"><UniversalSkeleton type="metrics" /></div>}>
            <CommandCenter />
        </Suspense>
    );
}

function CommandCenter() {
    const { id: projectId } = useParams<{ id: string }>();
    const router = useRouter();
    const search = useSearchParams();
    const platform = COMMAND_PLATFORMS.find((p) => p.id === search.get('platform')) || COMMAND_PLATFORMS[0];
    const tab = (TABS.find(([t]) => t === search.get('tab'))?.[0] || 'monitor') as Tab;
    const [name, setName] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const go = (next: { platform?: string; tab?: Tab }) =>
        router.replace(`/social-projects/${projectId}/command-center?platform=${next.platform || platform.id}&tab=${next.tab || tab}`, { scroll: false });

    const loadProject = () => {
        setError(null);
        socialProjectService.getProjects({})
            .then((d: any) => {
                const p = (d.projects || []).find((x: any) => x.id === projectId);
                if (p) setName(p.name);
                else setError('This project was not found in your workspace.');
            })
            .catch((e: any) => setError(e?.response?.data?.error || 'The project could not be loaded.'));
    };
    useEffect(loadProject, [projectId]);

    return (
        <div className="mx-auto max-w-7xl space-y-4 p-4 md:space-y-6 md:p-8">
            <div>
                <Button asChild variant="ghost" className="min-h-11 px-2"><Link href="/social-projects"><ArrowLeft className="mr-1 h-4 w-4" />Projects</Link></Button>
                <h1 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 md:text-3xl">Command Center</h1>
                {name && <p className="text-sm text-gray-600 dark:text-gray-400">{name}</p>}
            </div>

            {error ? (
                <ErrorBox message={error} onRetry={loadProject} secondary={<Button asChild variant="ghost" className="min-h-11"><Link href="/social-projects">Back to projects</Link></Button>} />
            ) : name === null ? (
                <UniversalSkeleton type="metrics" />
            ) : (
                <>
                    {tab !== 'scripts' && (
                        <div role="tablist" aria-label="Platform" className="flex gap-2 overflow-x-auto pb-1">
                            {COMMAND_PLATFORMS.map((p) => (
                                <Button key={p.id} role="tab" aria-selected={p.id === platform.id} variant={p.id === platform.id ? 'default' : 'outline'} className="min-h-11 shrink-0" onClick={() => go({ platform: p.id })}>{p.label}</Button>
                            ))}
                        </div>
                    )}
                    <div role="tablist" aria-label="Section" className="flex gap-2 overflow-x-auto border-b border-zinc-200 pb-2 dark:border-zinc-800">
                        {TABS.map(([t, label]) => (
                            <Button key={t} role="tab" aria-selected={t === tab} variant={t === tab ? 'secondary' : 'ghost'} className="min-h-11 shrink-0" onClick={() => go({ tab: t })}>{label}</Button>
                        ))}
                    </div>

                    {tab === 'monitor' && <MonitorPanel key={platform.id} platform={platform.id} label={platform.label} projectId={projectId} onCreate={() => go({ tab: 'create' })} />}
                    {tab === 'create' && <CreatePanel key={platform.id} platform={platform.id} label={platform.label} projectId={projectId} carousel={platform.carousel} />}
                    {tab === 'check' && <CheckPanel key={platform.id} platform={platform.id} label={platform.label} />}
                    {tab === 'scripts' && <ScriptsPanel projectId={projectId} />}
                </>
            )}
        </div>
    );
}

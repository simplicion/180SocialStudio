import * as React from 'react';
import { WifiOff, RefreshCw, ArrowRight, CheckCircle2, Laptop, FileText, CheckSquare, Film, LucideIcon } from 'lucide-react';
import { Button } from './Button';

export interface OfflineSuggestedAction {
    label: string;
    href: string;
    icon?: LucideIcon;
    description?: string;
}

export interface OfflineWallProps {
    /**
     * Name of the feature that requires active cloud connectivity
     * (e.g., 'WebRTC Video Conferencing', 'Live Payment Gateway', 'AI Telephony Sandbox')
     */
    featureName?: string;
    /**
     * Detailed explanation of why this feature is natively cloud-bound
     */
    reason?: string;
    /**
     * Custom actions to suggest while offline
     */
    suggestedActions?: OfflineSuggestedAction[];
    /**
     * Additional CSS classes
     */
    className?: string;
    /**
     * Render as full-screen viewport takeover or container overlay
     */
    fullScreen?: boolean;
    /**
     * Optional background content to render behind blurred overlay
     */
    children?: React.ReactNode;
    /**
     * Callback when connectivity is restored and user clicks Retry
     */
    onRetry?: () => void;
}

export function OfflineWall({
    featureName = 'Live Cloud Service',
    reason = 'This feature requires an active high-speed internet connection to communicate with remote cloud services in real time.',
    suggestedActions,
    className = '',
    fullScreen = false,
    children,
    onRetry
}: OfflineWallProps) {
    const [isChecking, setIsChecking] = React.useState(false);
    const [isOnline, setIsOnline] = React.useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);

    React.useEffect(() => {
        const handleOnline = () => {
            setIsOnline(true);
            if (onRetry) onRetry();
        };
        const handleOffline = () => {
            setIsOnline(false);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, [onRetry]);

    const handleManualRetry = async () => {
        setIsChecking(true);
        try {
            // Ping heartbeat endpoint or check navigator.onLine
            const onlineStatus = typeof navigator !== 'undefined' ? navigator.onLine : false;
            if (onlineStatus) {
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);
                    const res = await fetch('/api/health', { method: 'HEAD', signal: controller.signal }).catch(() => null);
                    clearTimeout(timeoutId);
                    if (res && res.ok) {
                        setIsOnline(true);
                        if (onRetry) onRetry();
                        return;
                    }
                } catch {
                    // Fallback to onLine status
                }
            }
            setIsOnline(navigator.onLine);
            if (navigator.onLine && onRetry) {
                onRetry();
            }
        } finally {
            setTimeout(() => setIsChecking(false), 500);
        }
    };

    const defaultActions: OfflineSuggestedAction[] = [
        {
            label: 'Projects & Tasks',
            href: '/tasks',
            icon: CheckSquare,
            description: 'Create, edit, and organize tasks with instant offline outbox replay.'
        },
        {
            label: 'Media Studio',
            href: '/media-editor',
            icon: Film,
            description: 'Edit multi-track videos offline with client-side WebCodecs GPU acceleration.'
        },
        {
            label: 'Documents & Contracts',
            href: '/documents',
            icon: FileText,
            description: 'Draft notes, documents, and client proposals locally.'
        }
    ];

    const actions = suggestedActions && suggestedActions.length > 0 ? suggestedActions : defaultActions;

    const content = (
        <div className="relative z-20 flex flex-col items-center justify-center max-w-xl mx-auto p-6 md:p-10 text-center">
            {/* Pulsing Offline Indicator Badge */}
            <div className="relative mb-6">
                <div className="w-20 h-20 rounded-3xl bg-amber-500/10 dark:bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shadow-lg shadow-amber-500/10 backdrop-blur-md">
                    <WifiOff className="w-10 h-10 text-amber-600 dark:text-amber-400 animate-pulse" />
                </div>
                <div className="absolute -bottom-1 -right-1 px-2 py-0.5 rounded-full bg-amber-600 text-[10px] font-bold tracking-wider uppercase text-white shadow-sm flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping"></span>
                    Offline
                </div>
            </div>

            {/* Header Text */}
            <h2 className="text-xl md:text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">
                {featureName} Requires Live Connection
            </h2>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed max-w-md">
                {reason}
            </p>

            {/* Live Reconnect Button */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Button
                    onClick={handleManualRetry}
                    disabled={isChecking}
                    variant="default"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-5 py-2.5 font-medium shadow-md shadow-indigo-600/20 transition-all flex items-center gap-2 text-sm"
                >
                    <RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />
                    {isChecking ? 'Checking Connection...' : 'Check Connection'}
                </Button>
            </div>

            {/* Recommended Offline Workflows */}
            <div className="w-full mt-10 text-left border-t border-zinc-200/80 dark:border-zinc-800/80 pt-6">
                <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        Available Offline Workflows
                    </span>
                    <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> 100% Offline-Ready
                    </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {actions.map((act, idx) => {
                        const Icon = act.icon || Laptop;
                        return (
                            <a
                                key={idx}
                                href={act.href}
                                className="group p-3 rounded-xl bg-zinc-50 hover:bg-white dark:bg-zinc-900/60 dark:hover:bg-zinc-800/80 border border-zinc-200/70 hover:border-indigo-500/40 dark:border-zinc-800 dark:hover:border-indigo-500/40 transition-all shadow-sm hover:shadow-md flex flex-col justify-between"
                            >
                                <div>
                                    <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                                        <Icon className="w-4 h-4" />
                                    </div>
                                    <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                        {act.label}
                                    </h4>
                                    {act.description && (
                                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1 line-clamp-2 leading-snug">
                                            {act.description}
                                        </p>
                                    )}
                                </div>
                                <div className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                                    <span>Open</span>
                                    <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                                </div>
                            </a>
                        );
                    })}
                </div>
            </div>
        </div>
    );

    if (fullScreen) {
        return (
            <div className={`fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/80 backdrop-blur-md p-4 overflow-y-auto ${className}`}>
                <div className="w-full max-w-2xl bg-white dark:bg-zinc-900 rounded-3xl border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden my-auto">
                    {content}
                </div>
            </div>
        );
    }

    return (
        <div className={`relative rounded-3xl overflow-hidden border border-zinc-200/80 dark:border-zinc-800/80 bg-white/95 dark:bg-zinc-950/95 shadow-sm min-h-[420px] flex items-center justify-center ${className}`}>
            {/* Background Content Blurred Layer */}
            {children && (
                <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden opacity-40 filter blur-[4px] grayscale-[30%]">
                    {children}
                </div>
            )}
            {/* Glassmorphism gradient layer */}
            <div className="absolute inset-0 z-10 bg-gradient-to-b from-white/60 via-white/80 to-white/95 dark:from-slate-950/60 dark:via-slate-950/80 dark:to-slate-950/95 backdrop-blur-[2px]"></div>

            {content}
        </div>
    );
}

export default OfflineWall;

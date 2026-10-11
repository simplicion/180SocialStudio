import * as React from 'react';
import { Lock } from 'lucide-react';
import { Button } from './Button';
import Link from 'next/link';

export interface FeatureLockProps {
    title?: string;
    description?: string;
    actionText?: string;
    actionHref?: string;
    className?: string;
    requiredApp?: string; // e.g., 'Sales CRM'
    children?: React.ReactNode;
}

export function FeatureLock({
    title,
    description,
    actionText = 'Upgrade Plan',
    actionHref = '/settings/platform-billing',
    className = '',
    requiredApp,
    children
}: FeatureLockProps) {
    const defaultTitle = requiredApp ? `${requiredApp} Required` : 'Premium Feature Locked';
    const defaultDescription = requiredApp 
        ? `The ${requiredApp} app must be installed to unlock this section. Upgrade your workspace to access this capability.`
        : 'Advanced configuration requires an active subscription. Upgrade your workspace to unlock this capability.';

    const displayTitle = title || defaultTitle;
    const displayDescription = description || defaultDescription;

    return (
        <div className={`relative rounded-[20px] overflow-hidden border border-slate-200/60 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-sm ${className}`}>
            {/* Background Content (either children or abstract blur shapes) */}
            <div className="absolute inset-0 z-0 pointer-events-none select-none overflow-hidden">
                {children ? (
                    <div className="w-full h-full p-4 opacity-90 filter blur-[3px] grayscale-[10%]">
                        {children}
                    </div>
                ) : (
                    <div className="w-full h-full opacity-60">
                        {/* Abstract dashboard-like skeleton blocks for a blurred effect */}
                        <div className="absolute top-6 left-6 w-32 h-6 bg-slate-200 dark:bg-zinc-800 rounded-md filter blur-md"></div>
                        <div className="absolute top-16 left-6 right-6 h-32 bg-slate-100 dark:bg-zinc-900 rounded-xl filter blur-xl"></div>
                        <div className="absolute top-56 left-6 w-1/2 h-24 bg-slate-50 dark:bg-zinc-900/60 rounded-xl filter blur-lg"></div>
                        <div className="absolute top-56 right-6 w-1/3 h-24 bg-slate-50 dark:bg-zinc-900/60 rounded-xl filter blur-lg"></div>
                    </div>
                )}
            </div>

            {/* Glassmorphism Overlay */}
            <div className="absolute inset-0 z-10 bg-white/20 dark:bg-black/50 backdrop-blur-[1px]"></div>
            
            {/* Lock Content */}
            <div className="relative z-20 flex flex-col items-center justify-center h-full min-h-[300px] p-8 text-center space-y-4">
                <div className="w-16 h-16 bg-white/80 dark:bg-zinc-900/90 backdrop-blur-md rounded-full flex items-center justify-center shadow-sm border border-slate-200/50 dark:border-zinc-800">
                    <Lock className="w-8 h-8 text-slate-500 dark:text-zinc-400" />
                </div>
                <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-zinc-100">{displayTitle}</h3>
                    <p className="text-sm text-slate-600 dark:text-zinc-400 max-w-md mx-auto mt-2 mb-6">
                        {displayDescription}
                    </p>
                    {actionHref && actionText && (
                        <div className="mt-6">
                            <Link href={actionHref}>
                                <Button variant="default" className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-full px-6 shadow-sm shadow-indigo-200 dark:shadow-none transition-all hover:scale-105">
                                    {actionText}
                                </Button>
                            </Link>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
